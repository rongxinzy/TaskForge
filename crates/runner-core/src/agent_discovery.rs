use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct DiscoveredAgent {
    pub name: String,
    pub adapter: String,
    pub path: String,
}

const KNOWN_AGENTS: &[(&str, &[&str])] = &[
    ("opencode", &["opencode"]),
    ("codex", &["codex"]),
    ("claude", &["claude", "claude-code"]),
    ("kimi", &["kimi"]),
];

pub fn discover_agents() -> Vec<DiscoveredAgent> {
    let mut found: HashMap<String, DiscoveredAgent> = HashMap::new();
    for (name, commands) in KNOWN_AGENTS {
        for cmd in *commands {
            if let Ok(path) = which::which(cmd) {
                let path_str = path.to_string_lossy().to_string();
                found.entry(name.to_string()).or_insert(DiscoveredAgent {
                    name: name.to_string(),
                    adapter: name.to_string(),
                    path: path_str,
                });
                break;
            }
        }
    }
    found.into_values().collect()
}
