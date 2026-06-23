# TaskForge — Exploring the Next Generation of Human-Agent Collaboration

[中文版本](README.md)

[![Build Local Runner](https://github.com/hawkli-1994/TaskForge/actions/workflows/runner.yml/badge.svg)](https://github.com/hawkli-1994/TaskForge/actions/workflows/runner.yml)
[![Docker Images](https://github.com/hawkli-1994/TaskForge/actions/workflows/docker.yml/badge.svg)](https://github.com/hawkli-1994/TaskForge/actions/workflows/docker.yml)

> When AI writes code faster than humans can review, test, or sync, waterfall, agile, and DevOps workflows start to break down. TaskForge is not another ChatGPT wrapper. It is a ground-up exploration of how humans and Agents can share context and collaborate.

## Why we are building this

The software and internet eras trained a massive generation of programmers. In the AI era, the field that actually consumes the most compute is still **Coding**.

OpenAI and Anthropic are pushing closed-source models toward coding-specialized capabilities. AI will eventually handle most work, but in the near term, writing code remains the largest, most demanded, and most compute-hungry domain.

When AI can deliver dozens of requirements and thousands of lines of code per day, two developers on the same product can easily diverge within hours—even if they synced in the morning. **Context sharing** between humans, and between humans and Agents, has become the new bottleneck.

TaskForge's mission is simple:

**Explore the next generation of collaboration.**

We use a database-driven control plane to unify WorkItems, ContextBundles, AgentSessions, and SessionEvents, so teams, Runners, and Agents operate on a single source of truth—instead of losing sync across Slack, Issues, local terminals, and endless Copilot windows.

## Core design

- **Database as the control plane**: All state, events, context, and approvals live in an append-only event stream that is auditable, replayable, and resumable.
- **Local-first**: v0.1 focuses on the Local Runner. Code executes on your own machine, with no opaque cloud runtime.
- **Agent Session**: One task, one session. Events are appended in order, driven by a state machine that supports resume, interruption, and awaiting input.
- **Context Bundle**: Packages requirements, code context, history, and recommended commands into an Agent-ready input, avoiding repeated context loading.
- **ACP compatible**: Runner-Agent communication follows the ACP protocol, making it possible to swap or connect different Agent backends in the future.

## Repository structure

```text
apps/
  web/            Next.js 14 management UI
  api/            NestJS REST API + Runner control plane
  worker/         BullMQ background workers
packages/
  db/             Prisma multi-database schema
  contracts/      Zod DTOs shared by API/Web/Runner
  domain/         Pure state machines and permission helpers
  repository-provider/  Repository provider abstraction port
crates/
  runner/         Rust Local Runner CLI
  runner-core/    ACP host, platform client, redaction, log replay
docs/
  v0.1_prd.md
  v0.1_technical_design.md
```

## Quick Start

### Option 1: Docker Compose one-click (recommended)

Requires Docker + Docker Compose.

```bash
git clone https://github.com/hawkli-1994/TaskForge.git
cd TaskForge

# Optional: configure environment variables
# cp .env.example .env

docker compose up -d
```

Services:

- Web UI: http://localhost:3000
- API: http://localhost:3001/api
- PostgreSQL: localhost:5432
- Redis: localhost:6379
- MinIO: http://localhost:9000 (console: http://localhost:9001)

Update to the latest images:

```bash
docker compose pull
docker compose up -d
```

Stop:

```bash
docker compose down
```

### Option 2: Local source development

Requires Node.js >= 22, pnpm >= 10, Rust >= 1.89.

```bash
# 1. Install dependencies
pnpm install

# 2. Start local infrastructure (optional; dev defaults to SQLite)
docker compose up -d postgres redis minio

# 3. Generate Prisma client and migrate the dev database
export DATABASE_URL="file:./packages/db/dev.db"
pnpm db:generate
pnpm db:migrate:dev
pnpm db:seed

# 4. Start API, Web and Worker in parallel
pnpm dev
```

- Web UI: http://localhost:3000
- API: http://localhost:3001/api

### Option 3: Rust Runner CLI direct connection

GitHub Actions automatically builds release binaries for Linux, macOS, and Windows.

**Download links:**

- Latest Release: https://github.com/hawkli-1994/TaskForge/releases/latest
- CI Artifacts (built on every push to main): https://github.com/hawkli-1994/TaskForge/actions/workflows/runner.yml

Download the latest release using the [GitHub CLI](https://cli.github.com/) (Linux example):

```bash
gh release download --repo hawkli-1994/TaskForge --latest \
  --pattern 'taskforge-runner-x86_64-unknown-linux-gnu'
chmod +x taskforge-runner-x86_64-unknown-linux-gnu
```

macOS (Apple Silicon):

```bash
gh release download --repo hawkli-1994/TaskForge --latest \
  --pattern 'taskforge-runner-aarch64-apple-darwin'
chmod +x taskforge-runner-aarch64-apple-darwin
```

Windows:

```powershell
gh release download --repo hawkli-1994/TaskForge --latest `
  --pattern 'taskforge-runner-x86_64-pc-windows-msvc.exe'
```

Start the Runner:

```bash
# Log in and register to your project
./taskforge-runner login --token <YOUR_RUNNER_TOKEN>
./taskforge-runner register --name my-runner --project-id <PROJECT_ID>

# Start and wait for tasks
./taskforge-runner start
```

Runner tokens can be created from the Web UI Runner settings page or via `POST /api/runner/tokens`.

You can also run from source:

```bash
cd crates/runner
cargo run --bin taskforge-runner -- login --token <TOKEN>
cargo run --bin taskforge-runner -- register --name my-runner --project-id <PROJECT_ID>
cargo run --bin taskforge-runner -- start
```

## Common scripts

```bash
pnpm lint              # TypeScript type check across the monorepo
pnpm typecheck         # same as lint
pnpm test              # Unit tests for packages/domain and apps/api
pnpm test:integration  # API integration tests against SQLite
pnpm db:validate       # Validate SQLite + PostgreSQL Prisma schemas
pnpm cargo:test        # Rust tests
```

## v0.1 scope notes

- Only Local Runner execution is supported; no cloud execution.
- ACP-compatible Agent integration is encapsulated in the Runner's `agent_host` module and can be swapped for a real ACP lifecycle without changing the platform.
- GitHub/GitLab Provider SDK integration is behind an abstract port. GitLab metadata fetching is implemented; GitHub remains a stub.
- See `docs/v0.1_prd.md` and `docs/v0.1_technical_design.md` for full requirements and design.

## GitLab integration

Set these before starting the API:

```bash
export GITLAB_API_TOKEN="<your-personal-access-token>"
export GITLAB_BASE_URL="http://172.18.5.179:8180"
```

Create a repository binding via the API:

```bash
curl -X POST http://localhost:3001/api/projects/<projectId>/repositories \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -d '{"provider":"gitlab","url":"http://172.18.5.179:8180/namespace/project"}'
```

## License

MIT © TaskForge Contributors
