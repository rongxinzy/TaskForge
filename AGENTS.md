# Repository Guidelines

## Project Structure & Module Organization

This repository is the implementation of TaskForge v0.1. The canonical product definition lives in `docs/v0.1_prd.md`; update it when changing TaskForge v0.1 scope, object models, state machines, or acceptance criteria. Keep repository-level guidance in `AGENTS.md`.

Source roots:

- `apps/web/` – Next.js UI
- `apps/api/` – NestJS REST API and Runner control plane
- `apps/worker/` – BullMQ background workers
- `packages/db/` – Prisma schema (SQLite dev, PostgreSQL prod) and seed
- `packages/contracts/` – Zod DTOs shared by API, Web, and Runner SDK
- `packages/domain/` – Pure state machines, permissions, and validation helpers
- `packages/repository-provider/` – Provider port abstraction for GitHub/GitLab
- `crates/runner/` – Rust Local Runner CLI
- `crates/runner-core/` – ACP host, platform client, spool, and redaction logic

Each app/package should keep its own README if it introduces non-trivial setup or scripts.

## Build, Test, and Development Commands

Install dependencies once:

```bash
pnpm install
```

Start local infrastructure (optional; SQLite is used for default dev):

```bash
docker compose up -d
```

Generate the Prisma client and prepare the dev SQLite database:

```bash
export DATABASE_URL="file:./packages/db/dev.db"
pnpm db:generate
pnpm db:migrate:dev
pnpm db:seed
```

Run the whole stack in development:

```bash
pnpm dev
```

- Web UI: http://localhost:3000
- API: http://localhost:3001/api

Other workspace commands:

```bash
pnpm lint              # tsc --noEmit across packages
pnpm typecheck         # same as lint
pnpm test              # unit tests
pnpm test:integration  # API integration tests (SQLite + Redis)
pnpm db:validate       # validate both SQLite and PostgreSQL Prisma schemas
pnpm cargo:test        # Rust tests
pnpm cargo:fmt         # Rust format check
pnpm cargo:clippy      # Rust clippy
```

## Coding Style & Naming Conventions

Markdown files should use concise headings, short paragraphs, and fenced code blocks for commands or examples. Keep existing product terms stable: `WorkItem`, `ContextBundle`, `ExecutionEnvelope`, `AgentSession`, `SessionEvent`, and `Local Runner`. Documentation filenames should follow the existing versioned pattern, for example `docs/v0.1_prd.md` or `docs/v0.2_architecture.md`.

TypeScript packages should use strict mode. Prefer descriptive names that match the PRD object model. NestJS controllers use kebab-case paths. Rust crates use `snake_case` modules and error types with `thiserror`.

## Frontend UI (ai-elements 优先)

The `apps/web` Next.js app has adopted [ai-elements](https://www.npmjs.com/package/ai-elements) as the preferred AI-native component layer (built on shadcn/ui).

- When building or refactoring UI that renders AI chat messages, reasoning, tool calls, terminal output, code blocks, conversations, or related AI-native patterns, **prefer an installed ai-elements component first**.
- If ai-elements does not provide a component that fits the exact semantic need (e.g. a domain-specific visualization that has no equivalent in the registry), implement a **minimal custom wrapper that still leverages the closest ai-elements primitives** (`Message`, `Tool`, `CodeBlock`, `Terminal`, etc.) and ask the user only when no reasonable primitive exists.
- Do not re-create from scratch what ai-elements already ships (e.g. collapsible tool cards, syntax highlighted code blocks, reasoning panels, auto-scrolling conversation containers).
- Add new ai-elements components with the project package runner: `pnpm dlx ai-elements@latest add <component>`.

## Testing Guidelines

Add tests beside the module they cover and document the test runner command. Core behavior must cover:

- WorkItem and AgentSession state transitions.
- Append-only SessionEvent ordering and seq validation.
- Runner preflight rejection and deny-path rules.
- Artifact redaction before upload.
- Session start transaction concurrency (no two active sessions on one WorkItem).

Run tests with `pnpm test`, `pnpm test:integration`, and `cargo test --workspace`.

## Commit & Pull Request Guidelines

Use short imperative commit subjects such as `docs: clarify runner constraints` or `feat: add session event model`. Pull requests should include a brief purpose statement, changed files or sections, linked issue if applicable, and screenshots only when UI artifacts are introduced.

## Architecture & Security Notes

Preserve the v0.1 boundary: TaskForge is a database-driven control plane with local execution only. Do not add cloud code execution, remote source checkout, Kubernetes business objects, or Runner pool scheduling unless the PRD is intentionally revised. Treat sensitive paths, command allowlists, artifact redaction, and audit logging as first-class requirements.
