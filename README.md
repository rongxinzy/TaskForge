# TaskForge

TaskForge is a product design and technical planning repository for a database-driven engineering task execution control plane.

The current repository contains:

- `docs/v0.1_prd.md`: v0.1 product requirements draft.
- `docs/v0.1_technical_design.md`: v0.1 technical design draft.
- `AGENTS.md`: contributor guide for future agents and maintainers.

Key architecture decisions in the current draft include:

- Local Runner implemented as a Rust native binary.
- Agent invocation through Agent Client Protocol (ACP), not a custom protocol.
- SQLite for local development and PostgreSQL for production.
- Plugin-based Repository Provider abstraction for GitHub, GitLab, and future code hosts.
- Mature open source SDKs preferred over hand-written platform clients.
