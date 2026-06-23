# TaskForge —— 下一代人机协作的探索

[English Version](README.en.md)

[![Build Local Runner](https://github.com/hawkli-1994/TaskForge/actions/workflows/runner.yml/badge.svg)](https://github.com/hawkli-1994/TaskForge/actions/workflows/runner.yml)
[![Docker Images](https://github.com/hawkli-1994/TaskForge/actions/workflows/docker.yml/badge.svg)](https://github.com/hawkli-1994/TaskForge/actions/workflows/docker.yml)

> 当 AI 写代码的速度已经超过人类评审、测试、同步的速度，旧的瀑布、敏捷、DevOps 流程正在集体失效。TaskForge 不是又一个 ChatGPT 套壳，而是一次对“人类与 Agent 如何共享上下文、如何协同工作”的底层重构。

## 我们为什么做这件事

软件时代和互联网时代培养了海量程序员，而 AI 时代真正消耗算力的主战场依然是 **Coding**。

OpenAI、Anthropic 已经把闭源模型朝着 Coding 特化的方向疯狂推进。可以预见，AI 终将胜任绝大多数工作，但在中短期内，写代码仍是最大、最刚需、算力消耗最惊人的应用领域。

当 AI 一天能完成几十个需求、产出上万行代码时，一个产品里的两个开发者即使早上刚对过信息，下午也可能在各自完全不同的上下文里推进。人类与人类之间、人类与 Agent 之间的**上下文共享**，已经成为新的瓶颈。

TaskForge 的定位很简单：

**探索下一代协作方式。**

我们用数据库驱动的控制平面把任务（WorkItem）、上下文（ContextBundle）、执行（AgentSession）和轨迹（SessionEvent）统一起来，让团队、Runner、Agent 在同一个事实源上协作，而不是在 Slack、Issue、本地终端和无数个 Copilot 窗口之间失去同步。

## 核心设计

- **数据库即控制平面**：所有状态、事件、上下文、审批都落在持久化事件流里，可审计、可回放、可恢复。
- **本地优先**：v0.1 聚焦 Local Runner，代码执行在你自己的机器上，无云端黑箱。
- **Agent Session**：一次任务对应一个会话，事件按序追加，状态机驱动，支持 resume、中断、等待输入。
- **Context Bundle**：把需求、代码上下文、历史、推荐命令打包成 Agent 可消费的输入，避免每次都从头加载上下文。
- **ACP 兼容**：Runner 与 Agent 之间采用 ACP 协议交互，未来可替换或接入不同 Agent 后端。

## 仓库结构

```text
apps/
  web/            Next.js 14 管理界面
  api/            NestJS REST API + Runner 控制平面
  worker/         BullMQ 后台任务
packages/
  db/             Prisma 多数据库 schema
  contracts/      Zod DTO，API/Web/Runner 共享
  domain/         纯状态机与权限辅助函数
  repository-provider/  仓库 Provider 抽象端口
crates/
  runner/         Rust 本地 Runner CLI
  runner-core/    ACP host、平台客户端、脱敏、日志回放
docs/
  v0.1_prd.md
  v0.1_technical_design.md
```

## Quick Start

### 方式一：Docker Compose 一键启动（推荐）

需要 Docker + Docker Compose。

```bash
git clone https://github.com/hawkli-1994/TaskForge.git
cd TaskForge

# 可选：配置环境变量
# cp .env.example .env

docker compose up -d
```

服务地址：

- Web UI: http://localhost:3000
- API: http://localhost:3001/api
- PostgreSQL: localhost:5432
- Redis: localhost:6379
- MinIO: http://localhost:9000（控制台 http://localhost:9001）

更新到最新镜像：

```bash
docker compose pull
docker compose up -d
```

停止：

```bash
docker compose down
```

### 方式二：本地源码开发

需要 Node.js >= 22、pnpm >= 10、Rust >= 1.89。

```bash
# 1. 安装依赖
pnpm install

# 2. 启动本地基础设施（可选；开发默认使用 SQLite）
docker compose up -d postgres redis minio

# 3. 生成 Prisma Client 并迁移开发数据库
export DATABASE_URL="file:./packages/db/dev.db"
pnpm db:generate
pnpm db:migrate:dev
pnpm db:seed

# 4. 同时启动 API、Web、Worker
pnpm dev
```

- Web UI: http://localhost:3000
- API: http://localhost:3001/api

### 方式三：Rust Runner CLI 直连

GitHub Actions 会自动为 Linux、macOS、Windows 构建 Release 二进制文件。

**下载地址：**

- 最新 Release：https://github.com/hawkli-1994/TaskForge/releases/latest
- CI Artifacts（每 push 到 main 生成）：https://github.com/hawkli-1994/TaskForge/actions/workflows/runner.yml

使用 [GitHub CLI](https://cli.github.com/) 下载最新 Release（以 Linux 为例）：

```bash
gh release download --repo hawkli-1994/TaskForge --latest \
  --pattern 'taskforge-runner-x86_64-unknown-linux-gnu'
chmod +x taskforge-runner-x86_64-unknown-linux-gnu
```

macOS（Apple Silicon）：

```bash
gh release download --repo hawkli-1994/TaskForge --latest \
  --pattern 'taskforge-runner-aarch64-apple-darwin'
chmod +x taskforge-runner-aarch64-apple-darwin
```

Windows：

```powershell
gh release download --repo hawkli-1994/TaskForge --latest `
  --pattern 'taskforge-runner-x86_64-pc-windows-msvc.exe'
```

启动 Runner：

```bash
# 登录并注册到你的项目
./taskforge-runner login --token <你的 Runner Token>
./taskforge-runner register --name my-runner --project-id <PROJECT_ID>

# 启动并等待任务
./taskforge-runner start
```

Runner Token 可在 Web UI 的 Runner 设置页或 `POST /api/runner/tokens` 创建。

也可以直接从源码运行：

```bash
cd crates/runner
cargo run --bin taskforge-runner -- login --token <TOKEN>
cargo run --bin taskforge-runner -- register --name my-runner --project-id <PROJECT_ID>
cargo run --bin taskforge-runner -- start
```

## 常用脚本

```bash
pnpm lint              # 全仓 TypeScript 类型检查
pnpm typecheck         # 同 lint
pnpm test              # packages/domain、apps/api 单元测试
pnpm test:integration  # API 集成测试（SQLite）
pnpm db:validate       # 校验 SQLite + PostgreSQL Prisma schema
pnpm cargo:test        # Rust 测试
```

## v0.1 范围说明

- 仅支持 Local Runner，不包含云端执行。
- ACP 兼容的 Agent 集成已封装在 Runner 的 `agent_host` 模块，可替换真实 ACP 生命周期而不改动平台代码。
- GitHub/GitLab Provider SDK 通过抽象端口接入，当前已实现 GitLab 元数据获取，GitHub 为占位实现。
- 完整需求与设计见 `docs/v0.1_prd.md` 和 `docs/v0.1_technical_design.md`。

## GitLab 集成

启动 API 前设置：

```bash
export GITLAB_API_TOKEN="<your-personal-access-token>"
export GITLAB_BASE_URL="http://172.18.5.179:8180"
```

通过 API 创建仓库绑定：

```bash
curl -X POST http://localhost:3001/api/projects/<projectId>/repositories \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -d '{"provider":"gitlab","url":"http://172.18.5.179:8180/namespace/project"}'
```

## License

MIT © TaskForge Contributors
