use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use std::process::Command as StdCommand;
use std::sync::Arc;
use std::time::Duration;
use taskforge_runner_core::{
    agent_discovery::discover_agents, AcpAgentHost, AgentHost, AuthStore, BindingDto,
    ClaimedSession, LocalBindingStore, LocalSpool, PlatformClient, RunnerConfig, RunnerError,
    RunnerRegistration, SessionEvent, StubAgentHost, VERSION,
};
use tokio::signal;
use tokio::sync::{Mutex, mpsc};
use tokio::time::interval;
use tracing::{debug, error, info, warn};

const HEARTBEAT_INTERVAL_SECS: u64 = 30;
const CLAIM_INTERVAL_SECS: u64 = 5;
const CAPABILITIES: &[&str] = &["execute", "patch", "verify", "stub-agent"];

#[derive(Parser, Debug)]
#[command(name = "taskforge-runner", version = VERSION, about = "TaskForge local runner")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Save an API token for authentication.
    Login {
        #[arg(long)]
        token: String,
    },

    /// Register this runner with the platform.
    Register {
        #[arg(long)]
        name: String,
        #[arg(long)]
        project_id: String,
        #[arg(long, default_value = "local")]
        adapter: String,
    },

    /// Bind a platform repository to a local path.
    BindRepo {
        #[arg(long)]
        repository_id: String,
        #[arg(long)]
        local_path: String,
    },

    /// Register and start the runner loop with a one-time token (like tailscale up).
    Up {
        #[arg(long)]
        token: String,
        #[arg(long)]
        name: Option<String>,
    },

    /// Start the runner loop.
    Start,

    /// Print current configuration and status.
    Status,

    /// Check connectivity, agent command, and bindings.
    Doctor,

    /// Remove locally stored credentials.
    Logout,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cli = Cli::parse();

    match cli.command {
        Commands::Login { token } => login(token).await,
        Commands::Register {
            name,
            project_id,
            adapter,
        } => register(name, project_id, adapter).await,
        Commands::BindRepo {
            repository_id,
            local_path,
        } => bind_repo(repository_id, local_path).await,
        Commands::Up { token, name } => up(token, name).await,
        Commands::Start => start().await,
        Commands::Status => status().await,
        Commands::Doctor => doctor().await,
        Commands::Logout => logout().await,
    }
}

async fn load_auth_and_config() -> Result<(RunnerConfig, AuthStore), RunnerError> {
    let mut config = RunnerConfig::load()?;
    let auth = AuthStore::from_config_dir()?;
    let auth_data = auth.load()?;
    if config.token.is_none() {
        config.token = auth_data.token;
    }
    if config.runner_id.is_none() {
        config.runner_id = auth_data.runner_id;
    }
    Ok((config, auth))
}

fn client_for(config: &RunnerConfig) -> PlatformClient {
    PlatformClient::new(config.api_url.clone(), config.token.clone())
}

fn bindings_for(config: &RunnerConfig) -> Vec<BindingDto> {
    config
        .local_bindings
        .iter()
        .map(|b| BindingDto {
            repository_id: b.repository_id.clone(),
            local_path: b.local_path.clone(),
            status: "bound".to_string(),
        })
        .collect()
}

async fn login(token: String) -> Result<()> {
    let auth = AuthStore::from_config_dir()?;
    let data = auth.load()?;
    auth.save(Some(&token), data.runner_id.as_deref())?;
    info!("saved API token");
    Ok(())
}

async fn register(name: String, project_id: String, adapter: String) -> Result<()> {
    let (config, auth) = load_auth_and_config().await?;
    let client = client_for(&config);
    let reg: RunnerRegistration = client
        .register(&name, &project_id, &adapter, capabilities())
        .await?;
    auth.save(Some(&reg.token), Some(&reg.runner_id))?;

    // Also persist project_id if not already set.
    let mut updated = config.clone();
    updated.token = Some(reg.token);
    updated.runner_id = Some(reg.runner_id);
    if updated.project_id.is_none() {
        updated.project_id = Some(project_id);
    }
    updated.save()?;
    info!(
        "registered runner {} and saved credentials",
        updated.runner_id.as_deref().unwrap_or("")
    );
    Ok(())
}

async fn up(reg_token: String, name: Option<String>) -> Result<()> {
    let config = RunnerConfig::load()?;
    let client = client_for(&config);
    let name = name.unwrap_or_else(|| default_runner_name());
    let reg: RunnerRegistration = client.up(&reg_token, &name, "local").await?;

    let auth = AuthStore::from_config_dir()?;
    auth.save(Some(&reg.token), Some(&reg.runner_id))?;

    let mut updated = config.clone();
    updated.token = Some(reg.token);
    updated.runner_id = Some(reg.runner_id);
    updated.save()?;

    info!("runner {} is up, starting loop", updated.runner_id.as_deref().unwrap_or(""));
    start_with_config(updated).await
}

fn default_runner_name() -> String {
    std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| "local-runner".to_string())
}

async fn bind_repo(repository_id: String, local_path: String) -> Result<()> {
    let (mut config, _) = load_auth_and_config().await?;
    let store = LocalBindingStore::new();
    let platform_url = store.platform_url_for_repo(&config, &repository_id);
    store.validate(&repository_id, &local_path, platform_url.as_deref())?;
    config.upsert_binding(repository_id, local_path);
    config.save()?;
    info!("updated repository binding");
    Ok(())
}

async fn status() -> Result<()> {
    let (config, auth) = load_auth_and_config().await?;
    println!("API URL:      {}", config.api_url);
    println!(
        "Token:        {}",
        config
            .token
            .as_ref()
            .map(|_| "***set***")
            .unwrap_or("not set")
    );
    println!(
        "Runner ID:    {}",
        config.runner_id.as_deref().unwrap_or("not registered")
    );
    println!(
        "Project ID:   {}",
        config.project_id.as_deref().unwrap_or("not set")
    );
    println!(
        "Agent command:{}",
        config.agent_command.as_deref().unwrap_or("default stub")
    );
    println!("Bindings:     {}", config.local_bindings.len());
    for b in &config.local_bindings {
        println!("  {} -> {}", b.repository_id, b.local_path);
    }
    println!("Auth file:    {:?}", auth.path());
    Ok(())
}

async fn doctor() -> Result<()> {
    let (config, _) = load_auth_and_config().await?;
    let client = client_for(&config);

    // API connectivity
    match client
        .heartbeat(
            "doctor",
            "online",
            VERSION,
            capabilities(),
            bindings_for(&config),
            vec![],
        )
        .await
    {
        Ok(()) => println!("API connectivity: OK"),
        Err(e) => {
            println!("API connectivity: FAILED ({})", e);
            // Do not fail the whole command so other checks still run.
        }
    }

    // Agent auto-discovery
    let discovered = discover_agents();
    if discovered.is_empty() {
        println!("Discovered agents: NONE");
    } else {
        println!("Discovered agents:");
        for a in &discovered {
            println!("  - {} ({}) -> {}", a.name, a.adapter, a.path);
        }
    }

    // Bindings
    let store = LocalBindingStore::new();
    for b in &config.local_bindings {
        let url = store.platform_url_for_repo(&config, &b.repository_id);
        match store.validate(&b.repository_id, &b.local_path, url.as_deref()) {
            Ok(()) => println!("Binding {}: OK", b.repository_id),
            Err(e) => println!("Binding {}: FAILED ({})", b.repository_id, e),
        }
    }

    Ok(())
}

async fn logout() -> Result<()> {
    let auth = AuthStore::from_config_dir()?;
    auth.clear()?;
    let mut config = RunnerConfig::load()?;
    config.token = None;
    config.runner_id = None;
    config.save()?;
    info!("logged out");
    Ok(())
}

async fn start() -> Result<()> {
    let (config, _auth) = load_auth_and_config().await?;
    start_with_config(config).await
}

async fn start_with_config(config: RunnerConfig) -> Result<()> {
    let runner_id = config.runner_id.clone().ok_or(RunnerError::NotRegistered)?;
    let token = config.token.clone().ok_or(RunnerError::NotAuthenticated)?;
    let client = Arc::new(PlatformClient::new(config.api_url.clone(), Some(token)));
    let spool = Arc::new(LocalSpool::from_default_dir()?);
    let busy = Arc::new(Mutex::new(false));
    let mut heartbeat = interval(Duration::from_secs(HEARTBEAT_INTERVAL_SECS));
    let mut claim_tick = interval(Duration::from_secs(CLAIM_INTERVAL_SECS));

    let discovered = discover_agents();
    let agent_dtos: Vec<_> = discovered
        .iter()
        .map(|a| taskforge_runner_core::platform::AgentDto {
            name: a.name.clone(),
            adapter: Some(a.adapter.clone()),
            status: "online".to_string(),
        })
        .collect();
    let mut caps = capabilities();
    for a in &discovered {
        if !caps.contains(&a.name) {
            caps.push(a.name.clone());
        }
    }

    if !discovered.is_empty() {
        info!("discovered agents: {}", discovered.iter().map(|a| &a.name).cloned().collect::<Vec<_>>().join(", "));
    } else {
        warn!("no supported agents found in PATH; session execution will fall back to stub");
    }

    info!("runner {} starting", runner_id);

    loop {
        tokio::select! {
            _ = heartbeat.tick() => {
                let status = if *busy.lock().await { "busy" } else { "online" };
                if let Err(e) = client.heartbeat(
                    &runner_id,
                    status,
                    VERSION,
                    caps.clone(),
                    bindings_for(&config),
                    agent_dtos.clone(),
                ).await {
                    warn!("heartbeat failed: {}", e);
                }

                // Attempt to drain the spool whenever we have connectivity.
                if let Err(e) = spool.drain(client.as_ref()).await {
                    warn!("spool drain failed: {}", e);
                }
            }
            _ = claim_tick.tick() => {
                if *busy.lock().await {
                    continue;
                }
                match client.claim_session(&runner_id).await {
                    Ok(Some(session)) => {
                        let busy_clone = busy.clone();
                        let client_clone = client.clone();
                        let spool_clone = spool.clone();
                        let config_clone = config.clone();
                        let runner_id_clone = runner_id.clone();
                        tokio::spawn(async move {
                            *busy_clone.lock().await = true;
                            if let Err(e) = run_session(
                                client_clone,
                                spool_clone,
                                config_clone,
                                &runner_id_clone,
                                session,
                            ).await {
                                error!("session error: {}", e);
                            }
                            *busy_clone.lock().await = false;
                        });
                    }
                    Ok(None) => debug!("no session available"),
                    Err(e) => warn!("claim failed: {}", e),
                }
            }
            _ = signal::ctrl_c() => {
                info!("received Ctrl-C, shutting down");
                break;
            }
        }
    }

    Ok(())
}

enum RunnerHost {
    Stub(StubAgentHost),
    Acp(AcpAgentHost),
}

impl AgentHost for RunnerHost {
    async fn run(
        &self,
        session: ClaimedSession,
        event_tx: mpsc::Sender<SessionEvent>,
    ) -> Result<(), RunnerError> {
        match self {
            RunnerHost::Stub(h) => h.run(session, event_tx).await,
            RunnerHost::Acp(h) => h.run(session, event_tx).await,
        }
    }
}

fn host_for_config(config: &RunnerConfig) -> RunnerHost {
    match config.agent_command.as_deref() {
        None => RunnerHost::Stub(StubAgentHost::new()),
        Some(cmd) if cmd.eq_ignore_ascii_case("stub") => RunnerHost::Stub(StubAgentHost::new()),
        Some(cmd) => {
            let mut tokens = cmd.split_whitespace();
            let program = tokens
                .next()
                .map(|s| s.to_string())
                .unwrap_or_else(|| cmd.to_string());
            let mut args: Vec<String> = tokens.map(|s| s.to_string()).collect();
            if !args.iter().any(|a| a.eq_ignore_ascii_case("acp")) {
                args.push("acp".to_string());
            }
            RunnerHost::Acp(AcpAgentHost::new(
                program,
                args,
                config.local_bindings.clone(),
            ))
        }
    }
}

async fn run_session(
    client: Arc<PlatformClient>,
    spool: Arc<LocalSpool>,
    config: RunnerConfig,
    runner_id: &str,
    session: ClaimedSession,
) -> Result<()> {
    info!("executing session {}", session.session_id);
    let host = host_for_config(&config);
    let (tx, mut rx) = mpsc::channel::<SessionEvent>(128);

    let session_id = session.session_id.clone();
    let upload_session_id = session_id.clone();
    let artifact_upload_url = session.artifact_upload_url.clone();
    let runner_id_owned = runner_id.to_string();
    let upload_client = client.clone();
    let upload_spool = spool.clone();

    let event_uploader = tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let Err(e) = client
                .append_event(
                    &runner_id_owned,
                    &session_id,
                    event.seq,
                    &event.event_type,
                    event.payload.clone(),
                )
                .await
            {
                warn!("event upload failed, spooling: {}", e);
                // Best-effort spool; ignore spool errors to keep session alive.
                let _ = spool.append(
                    &runner_id_owned,
                    &session_id,
                    event.seq,
                    &event.event_type,
                    event.payload,
                );
            }
        }
    });

    let host_handle = tokio::spawn(async move { host.run(session, tx).await });

    let host_result = host_handle.await.context("agent host panicked")?;
    host_result?;
    // Wait for the uploader task to finish; tx is dropped when host.run returns.
    event_uploader.await.context("event uploader panicked")?;

    // Upload a patch artifact when the claim response provides a URL.
    if !artifact_upload_url.is_empty() {
        let patch = sample_patch();
        if let Err(e) = upload_client
            .upload_artifact(
                runner_id,
                &upload_session_id,
                "patch",
                patch.into_bytes(),
                &artifact_upload_url,
            )
            .await
        {
            warn!("artifact upload failed: {}", e);
            // v0.1 stub: do not spool artifact failures.
        }
    }

    // After uploading, try to drain any spooled events.
    if let Err(e) = upload_spool.drain(upload_client.as_ref()).await {
        warn!("spool drain after session failed: {}", e);
    }

    info!("session {} finished", upload_session_id);
    Ok(())
}

fn capabilities() -> Vec<String> {
    CAPABILITIES.iter().map(|s| s.to_string()).collect()
}

fn sample_patch() -> String {
    r#"diff --git a/src/lib.rs b/src/lib.rs
index 1234567..abcdefg 100644
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,5 +1,5 @@
 pub fn greeting() -> &'static str {
-    "hello"
+    "hello, taskforge"
 }
"#
    .to_string()
}
