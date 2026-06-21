# TaskForge

TaskForge is a database-driven engineering task execution control plane. v0.1 focuses on the local-runner-first loop: a team can view WorkItems, compile ContextBundles, start AgentSessions on a local Runner, and observe the execution in real time.

## Repository structure

```text
apps/
  web/            Next.js UI
  api/            NestJS REST API + Runner control plane
  worker/         BullMQ background workers
packages/
  db/             Prisma schema (SQLite dev, PostgreSQL prod)
  contracts/      Zod DTOs shared by API/Web/Runner
  domain/         Pure state machines and permission helpers
  repository-provider/  Provider port (placeholder)
crates/
  runner/         Rust Local Runner CLI
  runner-core/    ACP host, platform client, spool, redaction
docs/
  v0.1_prd.md
  v0.1_technical_design.md
```

## Prerequisites

- Node.js >= 22 and pnpm >= 10
- Rust >= 1.89
- Docker + Docker Compose (for Postgres, Redis, MinIO in production-like mode)

## Quick start (Docker Compose one-click)

The fastest way to run the whole stack is with the pre-built images from GitHub Container Registry:

```bash
# 1. Clone or pull the latest code
git clone https://github.com/hawkli-1994/TaskForge.git
cd TaskForge

# 2. (Optional) configure environment; see .env.example
cp .env.example .env
# edit .env if you want to enable GitLab integration

# 3. Start everything
docker compose up -d
```

Services:

- Web UI: http://localhost:3000
- API: http://localhost:3001/api
- PostgreSQL: localhost:5432
- Redis: localhost:6379
- MinIO: http://localhost:9000 (console: http://localhost:9001)

Docker Compose will automatically:

1. Start Postgres, Redis and MinIO.
2. Run Prisma Postgres migrations in the API container.
3. Start API, Web and Worker containers.

To pull the latest images instead of building locally:

```bash
docker compose pull
docker compose up -d
```

To stop:

```bash
docker compose down
```

## Local development

If you prefer to run from source:

```bash
# 1. Install dependencies
pnpm install

# 2. Start local infrastructure (optional for dev; SQLite is used by default)
docker compose up -d postgres redis minio

# 3. Generate Prisma client and migrate the dev SQLite database
export DATABASE_URL="file:./packages/db/dev.db"
pnpm db:generate
pnpm db:migrate:dev
pnpm db:seed

# 4. Start API, Web and Worker in parallel
pnpm dev
```

- Web UI: http://localhost:3000
- API: http://localhost:3001/api

## Runner quick start

GitHub Actions automatically builds release binaries for Linux, macOS and Windows. You can download the latest binary from the Actions artifacts or from a GitHub Release page.

```bash
# Linux example
chmod +x taskforge-runner-x86_64-unknown-linux-gnu
./taskforge-runner-x86_64-unknown-linux-gnu login --token dev-token
./taskforge-runner-x86_64-unknown-linux-gnu register --name my-runner --project-id <PROJECT_ID>
./taskforge-runner-x86_64-unknown-linux-gnu start
```

Or run from source:

```bash
cd crates/runner
cargo run --bin taskforge-runner -- login --token dev-token
cargo run --bin taskforge-runner -- register --name my-runner --project-id <PROJECT_ID>
cargo run --bin taskforge-runner -- start
```

## Scripts

```bash
pnpm lint              # tsc --noEmit across packages
pnpm typecheck         # same as lint
pnpm test              # unit tests (packages/domain, apps/api)
pnpm test:integration  # API integration tests against SQLite
pnpm db:validate       # validate SQLite + PostgreSQL Prisma schemas
pnpm cargo:test        # Rust tests
```

## v0.1 scope notes

- Local Runner is the only execution target; no cloud execution.
- ACP-compatible Agent integration is stubbed behind the Runner `agent_host` module; real ACP lifecycle can be swapped in without changing the platform.
- GitHub/GitLab Provider SDK integration is behind an abstract port. GitLab metadata fetching is implemented; GitHub remains a stub.
- See `docs/v0.1_prd.md` and `docs/v0.1_technical_design.md` for full requirements.

## GitLab integration

To enable GitLab repository linking, set these environment variables before starting the API:

```bash
export GITLAB_API_TOKEN="<your-personal-access-token>"
export GITLAB_BASE_URL="http://172.18.5.179:8180"
```

Then create a repository via the API:

```bash
curl -X POST http://localhost:3001/api/projects/<projectId>/repositories \
  -H "Content-Type: application/json" \
  -H "x-taskforge-user-id: dev-user" \
  -H "x-taskforge-project-role: maintainer" \
  -d '{"provider":"gitlab","url":"http://172.18.5.179:8180/namespace/project"}'
```

The API will call GitLab to resolve `default_branch` and `project_id`.

A manual test script is also available:

```bash
GITLAB_API_TOKEN="<token>" \
GITLAB_REPO_URL="http://172.18.5.179:8180/namespace/project" \
  pnpm --filter @taskforge/api exec tsx scripts/test-gitlab.ts
```
