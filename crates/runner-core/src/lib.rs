pub mod acp_host;
pub mod agent_discovery;
pub mod agent_host;
pub mod auth;
pub mod binding;
pub mod config;
pub mod error;
pub mod platform;
pub mod redaction;
pub mod spool;

pub use acp_host::AcpAgentHost;
pub use agent_host::{AgentHost, SessionEvent, StubAgentHost};
pub use auth::{AuthData, AuthStore};
pub use binding::LocalBindingStore;
pub use config::{LocalBinding, RunnerConfig};
pub use error::RunnerError;
pub use platform::{
    ArtifactUploadResult, BindingDto, ClaimedSession, PlatformClient, RunnerRegistration,
};
pub use redaction::Redactor;
pub use spool::{LocalSpool, SpooledEvent};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Core types shared between runner modules.
#[derive(Debug, Clone, Default)]
pub struct RunnerStatus {
    pub runner_id: Option<String>,
    pub status: String,
    pub version: String,
}
