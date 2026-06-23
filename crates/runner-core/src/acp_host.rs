use crate::agent_host::{AgentHost, SessionEvent};
use crate::config::LocalBinding;
use crate::error::RunnerError;
use crate::platform::ClaimedSession;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command};
use tokio::sync::mpsc;
use tracing::{debug, info, warn};

#[derive(Debug, Clone, Serialize)]
struct JsonRpcRequest<T> {
    jsonrpc: &'static str,
    id: u64,
    method: &'static str,
    params: T,
}

#[derive(Debug, Clone, Deserialize)]
struct JsonRpcResponse<T> {
    id: Option<u64>,
    result: Option<T>,
    error: Option<JsonRpcError>,
}

#[derive(Debug, Clone, Deserialize)]
struct JsonRpcError {
    code: i64,
    message: String,
    #[serde(default, rename = "data")]
    _data: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InitializeResult {
    protocol_version: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionNewResult {
    session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionPromptResult {
    #[serde(default)]
    stop_reason: Option<String>,
    #[serde(default)]
    usage: Option<Value>,
    #[serde(default)]
    _meta: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
struct SessionUpdateNotification {
    #[serde(rename = "method")]
    _method: String,
    params: SessionUpdateParams,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionUpdateParams {
    session_id: String,
    update: Value,
}

#[derive(Debug, Clone)]
pub struct AcpAgentHost {
    program: String,
    args: Vec<String>,
    bindings: Vec<LocalBinding>,
}

impl AcpAgentHost {
    pub fn new(program: impl Into<String>, args: Vec<String>, bindings: Vec<LocalBinding>) -> Self {
        Self {
            program: program.into(),
            args,
            bindings,
        }
    }

    fn local_path_for_repo(&self, repository_id: Option<&String>) -> Option<PathBuf> {
        let repo_id = repository_id?;
        self.bindings
            .iter()
            .find(|b| &b.repository_id == repo_id)
            .map(|b| PathBuf::from(&b.local_path))
    }
}

impl Default for AcpAgentHost {
    fn default() -> Self {
        Self::new("opencode", vec!["acp".to_string()], Vec::new())
    }
}

struct EventEmitter<'a> {
    tx: &'a mpsc::Sender<SessionEvent>,
    session: &'a ClaimedSession,
    next_seq: u64,
}

impl<'a> EventEmitter<'a> {
    async fn send(
        &mut self,
        event_type: impl Into<String>,
        payload: Value,
    ) -> Result<(), RunnerError> {
        let seq = self.next_seq;
        self.next_seq += 1;
        self.tx
            .send(SessionEvent {
                seq,
                event_type: event_type.into(),
                payload,
            })
            .await
            .map_err(|_| RunnerError::AgentHost("event receiver dropped".into()))
    }
}

struct AcpClient<'a> {
    stdin: ChildStdin,
    stdout: Lines<BufReader<ChildStdout>>,
    emitter: EventEmitter<'a>,
    acp_session_id: Option<String>,
    chunk_buffer: HashMap<String, ChunkBuffer>,
}

#[derive(Debug, Clone)]
struct ChunkBuffer {
    event_type: String,
    text: String,
    raw: Value,
}

impl<'a> AcpClient<'a> {
    async fn send_request<T: Serialize>(
        &mut self,
        id: u64,
        method: &'static str,
        params: T,
    ) -> Result<(), RunnerError> {
        let req = JsonRpcRequest {
            jsonrpc: "2.0",
            id,
            method,
            params,
        };
        let line = serde_json::to_string(&req)?;
        debug!("acp -> {}", line);
        self.stdin.write_all(line.as_bytes()).await?;
        self.stdin.write_all(b"\n").await?;
        self.stdin.flush().await?;
        Ok(())
    }

    async fn read_line(&mut self) -> Result<String, RunnerError> {
        match self.stdout.next_line().await? {
            Some(line) => {
                debug!("acp <- {}", line);
                Ok(line)
            }
            None => Err(RunnerError::AgentHost("ACP stdout closed".into())),
        }
    }

    async fn wait_for_response<T: serde::de::DeserializeOwned>(
        &mut self,
        expected_id: u64,
    ) -> Result<T, RunnerError> {
        loop {
            let line = self.read_line().await?;
            let raw: Value = match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(e) => {
                    warn!("failed to parse ACP line as JSON: {}", e);
                    continue;
                }
            };

            if raw.get("method").is_some() && raw.get("id").is_none() {
                debug!("ignoring notification while waiting for response");
                continue;
            }

            let resp: JsonRpcResponse<T> = serde_json::from_value(raw)?;
            if resp.id != Some(expected_id) {
                warn!(
                    "unexpected response id {:?}, expected {}",
                    resp.id, expected_id
                );
                continue;
            }

            if let Some(err) = resp.error {
                return Err(RunnerError::AgentHost(format!(
                    "ACP error {}: {}",
                    err.code, err.message
                )));
            }

            return resp
                .result
                .ok_or_else(|| RunnerError::AgentHost("ACP response missing result".into()));
        }
    }

    async fn flush_chunk_buffer(
        &mut self,
        except_message_id: Option<&str>,
    ) -> Result<(), RunnerError> {
        let keys: Vec<String> = self
            .chunk_buffer
            .keys()
            .filter(|k| except_message_id.map(|id| id != k.as_str()).unwrap_or(true))
            .cloned()
            .collect();
        for key in keys {
            if let Some(buffer) = self.chunk_buffer.remove(&key) {
                self.emit_chunk_event(buffer).await?;
            }
        }
        Ok(())
    }

    async fn emit_chunk_event(&mut self, buffer: ChunkBuffer) -> Result<(), RunnerError> {
        let mut payload = serde_json::Map::new();
        payload.insert(
            "acpSessionId".into(),
            Value::String(self.acp_session_id.clone().unwrap_or_default()),
        );
        payload.insert("text".into(), Value::String(buffer.text));
        payload.insert("raw".into(), buffer.raw);
        self.emitter
            .send(buffer.event_type, Value::Object(payload))
            .await
    }
}

impl AgentHost for AcpAgentHost {
    async fn run(
        &self,
        session: ClaimedSession,
        event_tx: mpsc::Sender<SessionEvent>,
    ) -> Result<(), RunnerError> {
        info!(
            "acp agent starting session {} with {} {:?}",
            session.session_id, self.program, self.args
        );

        let mut cmd = Command::new(&self.program);
        cmd.args(&self.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child: Child = cmd
            .spawn()
            .map_err(|e| RunnerError::AgentHost(format!("failed to spawn ACP command: {}", e)))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| RunnerError::AgentHost("could not open stdin".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| RunnerError::AgentHost("could not open stdout".into()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| RunnerError::AgentHost("could not open stderr".into()))?;

        let _stderr_task = tokio::spawn(log_stderr(stderr, session.session_id.clone()));

        let mut client = AcpClient {
            stdin,
            stdout: BufReader::new(stdout).lines(),
            emitter: EventEmitter {
                tx: &event_tx,
                session: &session,
                next_seq: session.next_seq,
            },
            acp_session_id: None,
            chunk_buffer: HashMap::new(),
        };

        let result = run_acp_session(&mut client, &session, self).await;

        // Clean up.
        if let Some(acp_session_id) = client.acp_session_id.take() {
            let _ = cancel_session(&mut client.stdin, &acp_session_id).await;
        }
        let _ = client.stdin.shutdown().await;
        let _ = child.kill().await;
        let _ = child.wait().await;

        match result {
            Ok(()) => {
                info!("acp agent completed session {}", session.session_id);
                Ok(())
            }
            Err(e) => {
                warn!("acp agent failed session {}: {}", session.session_id, e);
                Err(e)
            }
        }
    }
}

async fn log_stderr(stderr: ChildStderr, session_id: String) {
    let reader = BufReader::new(stderr);
    let mut lines = reader.lines();
    while let Ok(Some(line)) = lines.next_line().await {
        warn!("acp stderr [{}]: {}", session_id, line);
    }
}

async fn cancel_session(stdin: &mut ChildStdin, acp_session_id: &str) -> Result<(), RunnerError> {
    let req = JsonRpcRequest {
        jsonrpc: "2.0",
        id: 0,
        method: "session/cancel",
        params: serde_json::json!({ "sessionId": acp_session_id }),
    };
    let line = serde_json::to_string(&req)?;
    debug!("acp -> {}", line);
    let _ = stdin.write_all(line.as_bytes()).await;
    let _ = stdin.write_all(b"\n").await;
    let _ = stdin.flush().await;
    Ok(())
}

async fn run_acp_session(
    client: &mut AcpClient<'_>,
    session: &ClaimedSession,
    host: &AcpAgentHost,
) -> Result<(), RunnerError> {
    if let Err(e) = run_acp_session_inner(client, session, host).await {
        let reason = e.to_string();
        let _ = emit_failure(&mut client.emitter, &reason).await;
        return Err(e);
    }
    Ok(())
}

async fn run_acp_session_inner(
    client: &mut AcpClient<'_>,
    session: &ClaimedSession,
    host: &AcpAgentHost,
) -> Result<(), RunnerError> {
    // initialize
    client
        .send_request(
            1,
            "initialize",
            serde_json::json!({
                "protocolVersion": 1,
                "clientCapabilities": {},
            }),
        )
        .await?;
    let init: InitializeResult = client.wait_for_response(1).await?;
    if init.protocol_version != 1 {
        return Err(RunnerError::AgentHost(format!(
            "unsupported ACP protocol version {}",
            init.protocol_version
        )));
    }

    // session/new
    let cwd = resolve_working_directory(session, host);
    if !cwd.exists() {
        client
            .emitter
            .send(
                "runner.working_directory_missing",
                serde_json::json!({
                    "session_id": session.session_id,
                    "path": cwd.to_string_lossy().to_string(),
                }),
            )
            .await?;
        return Err(RunnerError::AgentHost(format!(
            "working directory does not exist: {}",
            cwd.to_string_lossy()
        )));
    }
    let cwd_str = cwd.to_string_lossy().to_string();

    client
        .send_request(
            2,
            "session/new",
            serde_json::json!({
                "cwd": cwd_str,
                "mcpServers": [],
            }),
        )
        .await?;
    let new_result: SessionNewResult = client.wait_for_response(2).await?;
    client.acp_session_id = Some(new_result.session_id.clone());

    // Emit session.started event.
    client
        .emitter
        .send(
            "session.started",
            serde_json::json!({
                "session_id": session.session_id,
                "mode": session.mode,
                "acp_session_id": new_result.session_id,
                "cwd": cwd_str,
            }),
        )
        .await?;

    // session/prompt
    client
        .send_request(
            3,
            "session/prompt",
            serde_json::json!({
                "sessionId": new_result.session_id,
                "prompt": [{"type": "text", "text": session.prompt}],
            }),
        )
        .await?;

    let prompt_result: SessionPromptResult = read_prompt_stream(client).await?;

    client
        .emitter
        .send(
            "session.completed",
            serde_json::json!({
                "session_id": session.session_id,
                "outcome": prompt_result.stop_reason.unwrap_or_else(|| "success".into()),
                "usage": prompt_result.usage.unwrap_or(Value::Null),
            }),
        )
        .await?;

    Ok(())
}

async fn read_prompt_stream(
    client: &mut AcpClient<'_>,
) -> Result<SessionPromptResult, RunnerError> {
    loop {
        let line = client.read_line().await?;
        let raw: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                warn!("failed to parse ACP line as JSON: {}", e);
                continue;
            }
        };

        if raw.get("method").is_some() {
            let notification: SessionUpdateNotification = match serde_json::from_value(raw) {
                Ok(n) => n,
                Err(e) => {
                    warn!("failed to parse ACP notification: {}", e);
                    continue;
                }
            };
            handle_session_update(client, notification).await?;
            continue;
        }

        let resp: JsonRpcResponse<SessionPromptResult> = serde_json::from_value(raw)?;
        if resp.id != Some(3) {
            warn!("unexpected response id {:?}, expected 3", resp.id);
            continue;
        }

        if let Some(err) = resp.error {
            let message = format!("ACP prompt error {}: {}", err.code, err.message);
            client.flush_chunk_buffer(None).await?;
            emit_failure(&mut client.emitter, &message).await?;
            return Err(RunnerError::AgentHost(message));
        }

        client.flush_chunk_buffer(None).await?;
        return resp
            .result
            .ok_or_else(|| RunnerError::AgentHost("ACP prompt response missing result".into()));
    }
}

async fn handle_session_update(
    client: &mut AcpClient<'_>,
    notification: SessionUpdateNotification,
) -> Result<(), RunnerError> {
    let update = &notification.params.update;
    let update_type = update
        .get("sessionUpdate")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();

    // Buffer agent thought/message chunks by messageId to reduce event volume.
    if update_type == "agent_thought_chunk" || update_type == "agent_message_chunk" {
        let message_id = update
            .get("messageId")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        let text = update
            .get("content")
            .and_then(|v| v.get("text"))
            .and_then(|v| v.as_str())
            .or_else(|| update.get("text").and_then(|v| v.as_str()))
            .unwrap_or("")
            .to_string();

        // Flush buffers for other message ids before accumulating this one.
        client.flush_chunk_buffer(Some(&message_id)).await?;

        let event_type = map_update_type(&update_type);
        if let Some(buffer) = client.chunk_buffer.get_mut(&message_id) {
            buffer.text.push_str(&text);
            buffer.raw = update.clone();
        } else {
            client.chunk_buffer.insert(
                message_id,
                ChunkBuffer {
                    event_type: event_type.to_string(),
                    text,
                    raw: update.clone(),
                },
            );
        }
        return Ok(());
    }

    // For non-chunk updates, flush any pending chunks first.
    client.flush_chunk_buffer(None).await?;

    let event_type = map_update_type(&update_type);
    let mut payload = serde_json::Map::new();
    payload.insert(
        "acpSessionId".into(),
        Value::String(notification.params.session_id),
    );
    payload.insert("raw".into(), update.clone());

    if let Some(text) = update
        .get("content")
        .and_then(|v| v.get("text"))
        .and_then(|v| v.as_str())
        .or_else(|| update.get("text").and_then(|v| v.as_str()))
    {
        payload.insert("text".into(), Value::String(text.to_string()));
    }
    if let Some(id) = update.get("toolCallId").and_then(|v| v.as_str()) {
        payload.insert("toolCallId".into(), Value::String(id.to_string()));
    }

    client
        .emitter
        .send(event_type, Value::Object(payload))
        .await
}

fn map_update_type(update_type: &str) -> &'static str {
    match update_type {
        "agent_thought_chunk" => "agent.thinking",
        "agent_message_chunk" | "agent_message" => "agent.message",
        "tool_call" => "tool.call",
        "tool_call_update" => "tool.call_update",
        "usage_update" => "usage.update",
        "available_commands_update" => "acp.available_commands",
        _ => "acp.update",
    }
}

fn expand_tilde(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

fn resolve_working_directory(
    session: &ClaimedSession,
    host: &AcpAgentHost,
) -> PathBuf {
    if let Some(dir) = session.working_directory.as_ref() {
        return expand_tilde(dir);
    }
    if let Some(path) = host.local_path_for_repo(session.repository_id.as_ref()) {
        return path;
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

async fn emit_failure(emitter: &mut EventEmitter<'_>, reason: &str) -> Result<(), RunnerError> {
    emitter
        .send(
            "session.failed",
            serde_json::json!({
                "session_id": emitter.session.session_id,
                "reason": reason,
            }),
        )
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;

    #[test]
    fn map_update_type_mappings() {
        assert_eq!(map_update_type("agent_thought_chunk"), "agent.thinking");
        assert_eq!(map_update_type("agent_message_chunk"), "agent.message");
        assert_eq!(map_update_type("agent_message"), "agent.message");
        assert_eq!(map_update_type("tool_call"), "tool.call");
        assert_eq!(map_update_type("tool_call_update"), "tool.call_update");
        assert_eq!(map_update_type("usage_update"), "usage.update");
        assert_eq!(
            map_update_type("available_commands_update"),
            "acp.available_commands"
        );
        assert_eq!(map_update_type("something_else"), "acp.update");
    }

    #[tokio::test]
    async fn buffers_and_flushes_agent_chunks() {
        let session = ClaimedSession {
            session_id: "session-1".into(),
            work_item_id: "wi-1".into(),
            project_id: "proj-1".into(),
            repository_id: Some("repo-1".into()),
            mode: "task".into(),
            prompt: "do something".into(),
            artifact_upload_url: "http://example.com".into(),
            next_seq: 1,
            working_directory: None,
        };
        let (tx, mut rx) = mpsc::channel(128);

        // Spawn a cat process so we have real ChildStdin/ChildStdout types for the test client.
        let mut child = Command::new("cat")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();

        let mut client = AcpClient {
            stdin,
            stdout: BufReader::new(stdout).lines(),
            emitter: EventEmitter {
                tx: &tx,
                session: &session,
                next_seq: 1,
            },
            acp_session_id: Some("acp-session-1".into()),
            chunk_buffer: HashMap::new(),
        };

        let chunk1: SessionUpdateNotification = serde_json::from_str(
            r#"{
                "method": "session/update",
                "params": {
                    "sessionId": "acp-session-1",
                    "update": {
                        "sessionUpdate": "agent_message_chunk",
                        "messageId": "msg-1",
                        "content": {"type": "text", "text": "hello "}
                    }
                }
            }"#,
        )
        .unwrap();
        let chunk2: SessionUpdateNotification = serde_json::from_str(
            r#"{
                "method": "session/update",
                "params": {
                    "sessionId": "acp-session-1",
                    "update": {
                        "sessionUpdate": "agent_message_chunk",
                        "messageId": "msg-1",
                        "content": {"type": "text", "text": "world"}
                    }
                }
            }"#,
        )
        .unwrap();

        handle_session_update(&mut client, chunk1).await.unwrap();
        assert!(rx.try_recv().is_err(), "chunk should be buffered");

        handle_session_update(&mut client, chunk2).await.unwrap();
        assert!(rx.try_recv().is_err(), "chunk should still be buffered");

        // A non-chunk update flushes the buffered message.
        let tool_call: SessionUpdateNotification = serde_json::from_str(
            r#"{
                "method": "session/update",
                "params": {
                    "sessionId": "acp-session-1",
                    "update": {
                        "sessionUpdate": "tool_call",
                        "toolCallId": "call-1",
                        "title": "read"
                    }
                }
            }"#,
        )
        .unwrap();
        handle_session_update(&mut client, tool_call).await.unwrap();

        let event = rx.try_recv().unwrap();
        assert_eq!(event.event_type, "agent.message");
        assert_eq!(event.payload["text"], "hello world");
        assert_eq!(event.payload["acpSessionId"], "acp-session-1");

        let event2 = rx.try_recv().unwrap();
        assert_eq!(event2.event_type, "tool.call");
        assert_eq!(event2.payload["toolCallId"], "call-1");

        assert!(rx.try_recv().is_err());

        let _ = child.kill().await;
    }

    #[test]
    fn binding_resolution() {
        let host = AcpAgentHost::new(
            "opencode",
            vec!["acp".into()],
            vec![LocalBinding {
                repository_id: "repo-1".into(),
                local_path: "/tmp/repo".into(),
            }],
        );
        assert_eq!(
            host.local_path_for_repo(Some(&"repo-1".into())),
            Some(PathBuf::from("/tmp/repo"))
        );
        assert_eq!(host.local_path_for_repo(Some(&"missing".into())), None);
        assert_eq!(host.local_path_for_repo(None), None);
    }

    #[test]
    fn expands_tilde_to_home_directory() {
        let home = dirs::home_dir().expect("home dir available");
        assert_eq!(expand_tilde("~/workspace"), home.join("workspace"));
        assert_eq!(expand_tilde("/absolute/path"), PathBuf::from("/absolute/path"));
        assert_eq!(expand_tilde("relative/path"), PathBuf::from("relative/path"));
    }
}
