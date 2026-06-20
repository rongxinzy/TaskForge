# Repository Guidelines

## Project Structure & Module Organization

This repository is currently documentation-first. The canonical product definition lives in `docs/v0.1_prd.md`; update it when changing TaskForge v0.1 scope, object models, state machines, or acceptance criteria. Keep repository-level guidance in `AGENTS.md`. If implementation starts, place product docs under `docs/` and create explicit source roots such as `apps/`, `packages/`, or `runner/` with their own README files and scripts.

## Build, Test, and Development Commands

No build or test toolchain is defined yet. Use documentation inspection commands while the repo remains docs-only:

- `sed -n '1,120p' docs/v0.1_prd.md` reads the PRD overview.
- `rg "Local Runner|ExecutionEnvelope|AgentSession" docs/` checks core terminology.
- `wc -w docs/v0.1_prd.md` gives a rough size check before major rewrites.

When adding code, include the exact setup, dev, build, lint, and test commands in the new module README and wire them into package or workspace scripts.

## Coding Style & Naming Conventions

Markdown files should use concise headings, short paragraphs, and fenced code blocks for commands or examples. Keep existing product terms stable: `WorkItem`, `ContextBundle`, `ExecutionEnvelope`, `AgentSession`, `SessionEvent`, and `Local Runner`. Documentation filenames should follow the existing versioned pattern, for example `docs/v0.1_prd.md` or `docs/v0.2_architecture.md`.

For future code, prefer descriptive names that match the PRD object model. Do not introduce stack-specific conventions until the implementation stack is chosen and documented.

## Testing Guidelines

There are no automated tests yet. For documentation changes, verify links, headings, terminology, and consistency with the v0.1 scope. For future implementation, add tests beside the module they cover and document the test runner command. Core behavior should cover session state transitions, append-only event ordering, Runner preflight rejection, artifact redaction, and WorkItem status rules.

## Commit & Pull Request Guidelines

This directory is not currently a Git repository, so no local commit history conventions are available. Once Git is initialized, use short imperative commit subjects such as `docs: clarify runner constraints` or `feat: add session event model`. Pull requests should include a brief purpose statement, changed files or sections, linked issue if applicable, and screenshots only when UI artifacts are introduced.

## Architecture & Security Notes

Preserve the v0.1 boundary: TaskForge is a database-driven control plane with local execution only. Do not add cloud code execution, remote source checkout, Kubernetes business objects, or Runner pool scheduling unless the PRD is intentionally revised. Treat sensitive paths, command allowlists, artifact redaction, and audit logging as first-class requirements.
