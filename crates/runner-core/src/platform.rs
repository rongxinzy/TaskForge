use crate::error::RunnerError;
use chrono::{DateTime, Utc};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tracing::{debug, info};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunnerRegistration {
    pub runner_id: String,
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RegisterApiResponse {
    pub runner_id: String,
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct UpRequest {
    pub token: String,
    pub name: String,
    pub adapter: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimedSession {
    pub session_id: String,
    pub work_item_id: String,
    pub project_id: String,
    pub repository_id: Option<String>,
    pub mode: String,
    #[serde(rename = "content")]
    pub prompt: String,
    #[serde(default)]
    pub artifact_upload_url: String,
    #[serde(default = "default_next_seq")]
    pub next_seq: u64,
}

fn default_next_seq() -> u64 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactUploadResult {
    pub artifact_id: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeartbeatPayload {
    pub runner_id: String,
    pub status: String,
    pub version: String,
    pub capabilities: Vec<String>,
    pub bindings: Vec<BindingDto>,
    pub agents: Vec<AgentDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingDto {
    pub repository_id: String,
    pub local_path: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDto {
    pub name: String,
    pub adapter: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppendEventPayload {
    pub seq: u64,
    #[serde(rename = "type")]
    pub event_type: String,
    pub payload: Value,
    pub timestamp: DateTime<Utc>,
}

pub struct PlatformClient {
    client: Client,
    base_url: String,
    token: Option<String>,
}

impl PlatformClient {
    pub fn new(base_url: impl Into<String>, token: Option<String>) -> Self {
        Self {
            client: Client::new(),
            base_url: base_url.into(),
            token,
        }
    }

    fn auth_header(&self) -> Result<String, RunnerError> {
        match &self.token {
            Some(t) => Ok(format!("Bearer {}", t)),
            None => Err(RunnerError::NotAuthenticated),
        }
    }

    async fn handle_error(
        &self,
        resp: reqwest::Response,
    ) -> Result<reqwest::Response, RunnerError> {
        let status = resp.status();
        if status.is_success() {
            Ok(resp)
        } else {
            let text = resp.text().await.unwrap_or_else(|_| "unknown".into());
            Err(RunnerError::Platform {
                status: status.as_u16(),
                message: text,
            })
        }
    }

    fn runner_headers(
        &self,
        runner_id: Option<&str>,
    ) -> Result<reqwest::header::HeaderMap, RunnerError> {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::AUTHORIZATION,
            self.auth_header()?
                .parse()
                .map_err(|_| RunnerError::AgentHost("invalid auth header".into()))?,
        );
        headers.insert("x-taskforge-user-id", "runner".parse().unwrap());
        headers.insert("x-taskforge-project-role", "runner".parse().unwrap());
        if let Some(id) = runner_id {
            headers.insert("x-taskforge-runner-id", id.parse().unwrap());
        }
        Ok(headers)
    }

    pub async fn register(
        &self,
        name: &str,
        project_id: &str,
        adapter: &str,
        capabilities: Vec<String>,
    ) -> Result<RunnerRegistration, RunnerError> {
        let url = format!("{}/runner/register", self.base_url);
        let body = serde_json::json!({
            "name": name,
            "project_id": project_id,
            "adapter": adapter,
            "capabilities": capabilities,
        });
        debug!("POST {} with body {:?}", url, body);
        let resp = self
            .client
            .post(&url)
            .headers(self.runner_headers(None)?)
            .json(&body)
            .send()
            .await?;
        let resp = self.handle_error(resp).await?;
        let reg: RunnerRegistration = resp.json().await?;
        info!("registered runner {}", reg.runner_id);
        Ok(reg)
    }

    pub async fn up(
        &self,
        token: &str,
        name: &str,
        adapter: &str,
    ) -> Result<RunnerRegistration, RunnerError> {
        let url = format!("{}/runner/up", self.base_url);
        let body = UpRequest {
            token: token.to_string(),
            name: name.to_string(),
            adapter: adapter.to_string(),
        };
        debug!("POST {}", url);
        let resp = self
            .client
            .post(&url)
            .headers(self.runner_headers(None)?)
            .json(&body)
            .send()
            .await?;
        let resp = self.handle_error(resp).await?;
        let reg: RunnerRegistration = resp.json().await?;
        info!("runner up: registered {}", reg.runner_id);
        Ok(reg)
    }

    pub async fn heartbeat(
        &self,
        runner_id: &str,
        status: &str,
        version: &str,
        capabilities: Vec<String>,
        bindings: Vec<BindingDto>,
        agents: Vec<AgentDto>,
    ) -> Result<(), RunnerError> {
        let url = format!("{}/runner/heartbeat", self.base_url);
        let payload = HeartbeatPayload {
            runner_id: runner_id.to_string(),
            status: status.to_string(),
            version: version.to_string(),
            capabilities,
            bindings,
            agents,
        };
        let resp = self
            .client
            .post(&url)
            .headers(self.runner_headers(Some(runner_id))?)
            .json(&payload)
            .send()
            .await?;
        self.handle_error(resp).await?;
        debug!("heartbeat sent for {}", runner_id);
        Ok(())
    }

    pub async fn claim_session(
        &self,
        runner_id: &str,
    ) -> Result<Option<ClaimedSession>, RunnerError> {
        let url = format!("{}/runner/sessions/claim", self.base_url);
        let resp = self
            .client
            .post(&url)
            .headers(self.runner_headers(Some(runner_id))?)
            .send()
            .await?;
        if resp.status() == StatusCode::NO_CONTENT {
            return Ok(None);
        }
        let resp = self.handle_error(resp).await?;
        let session: ClaimedSession = resp.json().await?;
        info!("claimed session {}", session.session_id);
        Ok(Some(session))
    }

    pub async fn append_event(
        &self,
        runner_id: &str,
        session_id: &str,
        seq: u64,
        event_type: &str,
        payload: Value,
    ) -> Result<(), RunnerError> {
        let url = format!("{}/runner/sessions/{}/events", self.base_url, session_id);
        let body = AppendEventPayload {
            seq,
            event_type: event_type.to_string(),
            payload,
            timestamp: Utc::now(),
        };
        let resp = self
            .client
            .post(&url)
            .headers(self.runner_headers(Some(runner_id))?)
            .json(&body)
            .send()
            .await?;
        self.handle_error(resp).await?;
        debug!("appended event {}:{} {}", session_id, seq, event_type);
        Ok(())
    }

    pub async fn upload_artifact(
        &self,
        runner_id: &str,
        _session_id: &str,
        artifact_type: &str,
        data: Vec<u8>,
        upload_url: &str,
    ) -> Result<ArtifactUploadResult, RunnerError> {
        let resp = self
            .client
            .post(upload_url)
            .headers(self.runner_headers(Some(runner_id))?)
            .header("X-Artifact-Type", artifact_type)
            .body(data)
            .send()
            .await?;
        let resp = self.handle_error(resp).await?;
        let result: ArtifactUploadResult = resp.json().await?;
        info!("uploaded artifact {}", result.artifact_id);
        Ok(result)
    }
}
