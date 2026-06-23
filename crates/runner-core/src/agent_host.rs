use crate::error::RunnerError;
use crate::platform::ClaimedSession;
use serde_json::{Value, json};
use tokio::sync::mpsc;
use tokio::time::{Duration, sleep};
use tracing::{info, warn};

#[derive(Debug, Clone)]
pub struct SessionEvent {
    pub seq: u64,
    pub event_type: String,
    pub payload: Value,
}

pub trait AgentHost: Send + Sync {
    fn run(
        &self,
        session: ClaimedSession,
        event_tx: mpsc::Sender<SessionEvent>,
    ) -> impl std::future::Future<Output = Result<(), RunnerError>> + Send;
}

pub struct StubAgentHost;

impl StubAgentHost {
    pub fn new() -> Self {
        Self
    }

    fn sample_patch() -> String {
        r#"--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,5 +1,5 @@
 pub fn greeting() -> &'static str {
-    "hello"
+    "hello, world"
 }
 
 pub fn add(a: i32, b: i32) -> i32 {
"#
        .to_string()
    }
}

impl Default for StubAgentHost {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentHost for StubAgentHost {
    async fn run(
        &self,
        session: ClaimedSession,
        event_tx: mpsc::Sender<SessionEvent>,
    ) -> Result<(), RunnerError> {
        info!("stub agent starting session {}", session.session_id);

        let cwd = session
            .working_directory
            .clone()
            .unwrap_or_else(|| "/workspace".to_string());
        let mut next_seq = session.next_seq;
        let event_templates: Vec<(&str, Value)> = vec![
            (
                "session.started",
                json!({ "session_id": session.session_id, "mode": session.mode, "cwd": cwd }),
            ),
            (
                "command.started",
                json!({ "command": "analyze prompt", "cwd": cwd }),
            ),
            (
                "command.output",
                json!({ "stdout": "analyzing work item...", "stderr": "" }),
            ),
            ("command.finished", json!({ "exit_code": 0 })),
            (
                "file.changed",
                json!({
                    "path": "src/lib.rs",
                    "change_type": "modified",
                    "diff": Self::sample_patch()
                }),
            ),
            (
                "verification.started",
                json!({ "tool": "cargo test", "args": ["--lib"] }),
            ),
            ("verification.passed", json!({ "tool": "cargo test" })),
            (
                "session.completed",
                json!({ "session_id": session.session_id, "outcome": "success" }),
            ),
        ];

        for (event_type, payload) in event_templates {
            sleep(Duration::from_millis(800)).await;
            let seq = next_seq;
            next_seq += 1;
            if event_tx
                .send(SessionEvent {
                    seq,
                    event_type: event_type.to_string(),
                    payload,
                })
                .await
                .is_err()
            {
                warn!("event receiver dropped; aborting agent session");
                return Err(RunnerError::AgentHost("event receiver dropped".into()));
            }
        }

        info!("stub agent completed session {}", session.session_id);
        Ok(())
    }
}
