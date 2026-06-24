import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import {
  AppendSessionEventInput,
  RunnerHeartbeatInput,
  RunnerRegisterInput,
  RunnerUpInput,
  SetRunnerVisibilityInput,
  UploadArtifactInput,
  type EventType,
  type RunnerStatus,
  type SessionStatus,
  type WorkItemStatus,
} from "@taskforge/contracts";
import {
  isSessionActive,
  isSessionTerminal,
  nextEventSeq,
  runnerCanClaimSession,
  workItemStatusFromSessionResult,
} from "@taskforge/domain";
import { PrismaService } from "../common/prisma.service";
import { RedisService } from "../common/redis.service";
import { renderPrompt } from "../common/prompt.util";
import { AuditService } from "../audit/audit.service";
import { OutboxService } from "../outbox/outbox.service";
import { ProjectsService } from "../projects/projects.service";
import * as crypto from "crypto";

const EVENT_TO_SESSION_STATUS: Partial<Record<EventType, SessionStatus>> = {
  "session.started": "running",
  "runner.accepted": "running",
  "runner.dispatched": "dispatching",
  "session.awaiting_input": "awaiting_input",
  "approval.requested": "awaiting_approval",
  "verification.started": "verifying",
  "runner.working_directory_missing": "failed",
  "session.completed": "completed",
  "session.failed": "failed",
  "session.cancelled": "cancelled",
  "session.interrupted": "interrupted",
};

@Injectable()
export class RunnerService {
  private readonly REG_TOKEN_PREFIX = "runner:register:";
  private readonly REG_TOKEN_TTL_SECONDS = 15 * 60;
  private readonly CLAIM_AVAILABLE_KEY = "runner:claims:available";
  private readonly HEARTBEAT_TIMEOUT_MS = 30_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly projects: ProjectsService,
  ) {}

  async register(input: RunnerRegisterInput, actorId: string) {
    if (input.projectId) {
      await this.projects.requireAccess(actorId, input.projectId, "contributor");
    }
    return this.createRunnerProfile(input, actorId, input.projectId ?? null);
  }

  async createRegistrationToken(actorId: string, projectId?: string) {
    if (projectId) {
      await this.projects.requireAccess(actorId, projectId, "maintainer");
    }
    const token = crypto.randomBytes(32).toString("hex");
    await this.redis.getClient().setex(
      `${this.REG_TOKEN_PREFIX}${token}`,
      this.REG_TOKEN_TTL_SECONDS,
      JSON.stringify({ userId: actorId, projectId: projectId ?? null }),
    );
    return { token };
  }

  async up(input: RunnerUpInput) {
    const data = await this.redis
      .getClient()
      .get(`${this.REG_TOKEN_PREFIX}${input.token}`);
    if (!data) {
      throw new BadRequestException("Invalid or expired runner token");
    }
    const { userId, projectId } = JSON.parse(data) as {
      userId: string;
      projectId: string;
    };

    const result = await this.createRunnerProfile(
      {
        name: input.name,
        adapter: input.adapter ?? "local",
      },
      userId,
      projectId,
    );

    await this.redis
      .getClient()
      .del(`${this.REG_TOKEN_PREFIX}${input.token}`);

    return { ...result, platformUrl: input.platformUrl };
  }

  private async createRunnerProfile(
    input: Pick<RunnerRegisterInput, "name" | "adapter" | "agents" | "scope">,
    ownerId: string,
    projectId: string | null,
  ) {
    const token = crypto.randomUUID();
    const runner = await this.prisma.runnerProfile.create({
      data: {
        ownerId,
        projectId,
        name: input.name,
        token,
        adapter: input.adapter ?? null,
        status: "online",
        scope: input.scope ?? "personal",
        capabilities: ({} as any),
        lastHeartbeatAt: new Date(),
        agents: {
          create: (input.agents ?? []).map((a) => ({
            name: a.name,
            adapter: a.adapter ?? null,
            status: a.status ?? "online",
            lastHeartbeatAt: new Date(),
          })),
        },
      },
      include: { agents: true },
    });
    await this.audit.log("runner.registered", ownerId, "runner", runner.id, {
      name: input.name,
    });
    return { runner_id: runner.id, token, agents: runner.agents };
  }

  async heartbeat(runnerId: string, input: RunnerHeartbeatInput) {
    const runner = await this.prisma.runnerProfile.findUnique({
      where: { id: runnerId },
    });
    if (!runner) {
      throw new NotFoundException("Runner not found");
    }

    await this.prisma.runnerProfile.update({
      where: { id: runnerId },
      data: {
        status: input.status,
        version: input.version ?? runner.version,
        capabilities: (input.capabilities ?? runner.capabilities) as any,
        lastHeartbeatAt: new Date(),
      },
    });

    if (input.bindings) {
      for (const binding of input.bindings) {
        if (binding.status === "unbound") {
          await this.prisma.repositoryBinding.deleteMany({
            where: { runnerId, repositoryId: binding.repositoryId },
          });
        } else {
          await this.prisma.repositoryBinding.upsert({
            where: {
              runnerId_repositoryId: {
                runnerId,
                repositoryId: binding.repositoryId,
              },
            },
            create: {
              runnerId,
              repositoryId: binding.repositoryId,
              status: binding.status,
              localPath: "",
              remoteUrl: "",
            },
            update: { status: binding.status },
          });
        }
      }
    }

    if (input.agents) {
      for (const agent of input.agents) {
        await this.prisma.runnerAgent.upsert({
          where: { runnerId_name: { runnerId, name: agent.name } },
          create: {
            runnerId,
            name: agent.name,
            adapter: agent.adapter ?? null,
            status: agent.status ?? "online",
            lastHeartbeatAt: new Date(),
          },
          update: {
            adapter: agent.adapter ?? undefined,
            status: agent.status ?? undefined,
            lastHeartbeatAt: new Date(),
          },
        });
      }
    }

    return { ok: true };
  }

  async listForProject(projectId: string, actorId: string) {
    await this.projects.requireAccess(actorId, projectId, "viewer");
    const runners = await this.prisma.runnerProfile.findMany({
      where: {
        ownerId: actorId,
        OR: [{ projectId: null }, { projectId }],
      },
      select: {
        id: true,
        ownerId: true,
        projectId: true,
        name: true,
        status: true,
        scope: true,
        adapter: true,
        version: true,
        capabilities: true,
        lastHeartbeatAt: true,
        createdAt: true,
        updatedAt: true,
        agents: { orderBy: { name: "asc" } },
        visibilities: {
          where: { projectId },
          take: 1,
        },
      },
      orderBy: { lastHeartbeatAt: "desc" },
    });
    return runners.filter((r) => {
      const override = r.visibilities[0];
      return override ? override.visible : true;
    });
  }

  async setVisibility(
    runnerId: string,
    input: SetRunnerVisibilityInput,
    actorId: string,
  ) {
    const runner = await this.prisma.runnerProfile.findUnique({
      where: { id: runnerId },
    });
    if (!runner) {
      throw new NotFoundException("Runner not found");
    }
    if (runner.ownerId !== actorId) {
      throw new ForbiddenException("Runner does not belong to you");
    }
    await this.projects.requireAccess(actorId, input.projectId, "viewer");

    if (input.visible) {
      await this.prisma.runnerProjectVisibility.deleteMany({
        where: { runnerId, projectId: input.projectId },
      });
    } else {
      await this.prisma.runnerProjectVisibility.upsert({
        where: {
          runnerId_projectId: { runnerId, projectId: input.projectId },
        },
        create: {
          runnerId,
          projectId: input.projectId,
          visible: false,
        },
        update: { visible: false },
      });
    }
    return { ok: true };
  }

  async claim(runnerId: string) {
    const runner = await this.prisma.runnerProfile.findUnique({
      where: { id: runnerId },
    });
    if (!runner || !runnerCanClaimSession(runner.status as RunnerStatus)) {
      return null;
    }

    const available = await this.redis.getClient().get(this.CLAIM_AVAILABLE_KEY);
    if (available !== "1") {
      return null;
    }

    return this.prisma.$transaction(async (tx) => {
      const session = await tx.agentSession.findFirst({
        where: {
          status: { in: ["dispatching", "queued"] },
          OR: [{ runnerId }, { runnerId: null }],
        },
        orderBy: { createdAt: "asc" },
        include: { workItem: true, contextBundle: true },
      });
      if (!session) {
        await this.redis.getClient().set(this.CLAIM_AVAILABLE_KEY, "0");
        return null;
      }

      const maxSeq = await tx.sessionEvent.aggregate({
        where: { sessionId: session.id },
        _max: { seq: true },
      });
      const seq = nextEventSeq(maxSeq._max.seq);

      await tx.agentSession.update({
        where: { id: session.id },
        data: {
          status: "running",
          runnerId,
          startedAt: new Date(),
        },
      });
      await tx.sessionEvent.create({
        data: {
          sessionId: session.id,
          seq,
          type: "runner.accepted",
          payload: { runnerId },
        },
      });

      const agentInfo = (session.acpAgentInfoJson ?? {}) as Record<
        string,
        unknown
      >;

      let promptText = agentInfo.prompt as string | undefined;
      if (!promptText) {
        const promptVersion = await tx.promptVersion.findFirst({
          where: { mode: session.mode },
          orderBy: { version: "desc" },
        });
        promptText = renderPrompt(
          promptVersion?.template ?? "",
          session.workItem,
          session.contextBundle,
        );
      }

      const remaining = await tx.agentSession.count({
        where: {
          status: { in: ["dispatching", "queued"] },
          OR: [{ runnerId }, { runnerId: null }],
        },
      });
      if (remaining === 0) {
        await this.redis.getClient().set(this.CLAIM_AVAILABLE_KEY, "0");
      }

      const acp = {
        sessionId: session.id,
        workItemId: session.workItemId,
        projectId: session.workItem.projectId,
        repositoryId: session.workItem.repositoryId ?? null,
        mode: session.mode,
        agentName: (agentInfo.agentName as string | null) ?? null,
        workingDirectory: session.workingDirectory ?? null,
        content: promptText,
        nextSeq: seq + 1,
      };

      return acp;
    });
  }

  async appendEvent(
    runnerId: string,
    sessionId: string,
    input: AppendSessionEventInput,
  ) {
    let terminal = false;

    const result = await this.prisma.$transaction(async (tx) => {
      const session = await tx.agentSession.findUnique({
        where: { id: sessionId },
        include: { workItem: true },
      });
      if (!session) {
        throw new NotFoundException("Session not found");
      }
      if (session.runnerId && session.runnerId !== runnerId) {
        throw new ForbiddenException("Runner is not assigned to this session");
      }

      const maxSeq = await tx.sessionEvent.aggregate({
        where: { sessionId },
        _max: { seq: true },
      });
      const expectedSeq = nextEventSeq(maxSeq._max.seq);
      if (input.seq !== expectedSeq) {
        throw new BadRequestException(
          `Expected event seq ${expectedSeq}, got ${input.seq}`,
        );
      }

      await tx.sessionEvent.create({
        data: {
          sessionId,
          seq: input.seq,
          type: input.type,
          payload: input.payload as any,
          rawAcpJson: (input.rawAcpJson ?? null) as any,
        },
      });

      const newStatus = EVENT_TO_SESSION_STATUS[input.type];
      if (newStatus) {
        const updateData: {
          status: SessionStatus;
          completedAt?: Date;
        } = { status: newStatus };
        if (isSessionTerminal(newStatus)) {
          updateData.completedAt = new Date();
          terminal = true;
        }
        await tx.agentSession.update({
          where: { id: sessionId },
          data: updateData,
        });

        if (isSessionTerminal(newStatus)) {
          const workItemStatus =
            workItemStatusFromSessionResult(newStatus);
          const workItemUpdate: { activeSessionId: null; status?: WorkItemStatus } =
            { activeSessionId: null };
          if (workItemStatus) {
            workItemUpdate.status = workItemStatus;
          }
          const workItem = await tx.workItem.findUnique({
            where: { id: session.workItemId },
          });
          if (workItem && workItem.activeSessionId === sessionId) {
            await tx.workItem.update({
              where: { id: session.workItemId },
              data: workItemUpdate,
            });
          }
        }
      }

      await tx.auditLog.create({
        data: {
          action: "session.event_appended",
          actorId: runnerId,
          targetType: "session",
          targetId: sessionId,
          payload: { type: input.type, seq: input.seq },
        },
      });

      return tx.agentSession.findUnique({
        where: { id: sessionId },
        include: { events: { orderBy: { seq: "asc" } } },
      });
    });

    if (terminal) {
      // Kick off PR resolution after the session reaches a terminal state.
      await this.outbox.enqueueResolvePr(sessionId).catch((err) => {
        console.error(`[runner] resolve_pr enqueue failed:`, err);
      });
    }

    return result;
  }

  async uploadArtifact(
    runnerId: string,
    sessionId: string,
    input: UploadArtifactInput,
  ) {
    const session = await this.prisma.agentSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException("Session not found");
    }
    if (session.runnerId && session.runnerId !== runnerId) {
      throw new ForbiddenException("Runner is not assigned to this session");
    }

    const artifact = await this.prisma.artifact.create({
      data: {
        sessionId,
        type: input.type,
        storageUrl: `http://localhost:3001/api/artifacts/${sessionId}/upload`,
        sha256: input.sha256 ?? null,
        sizeBytes: input.sizeBytes ?? null,
        redactionStatus: input.redactionStatus ?? "pending",
        metadata: (input.metadata ?? {}) as any,
      },
    });

    await this.audit.log(
      "artifact.upload_initiated",
      runnerId,
      "artifact",
      artifact.id,
      { sessionId, type: input.type },
    );

    return {
      artifactId: artifact.id,
      uploadUrl: `${artifact.storageUrl}?signature=stub&artifactId=${artifact.id}`,
    };
  }

  @Cron("*/10 * * * * *")
  async releaseOfflineRunnerSessions() {
    const cutoff = new Date(Date.now() - this.HEARTBEAT_TIMEOUT_MS);
    const offlineRunners = await this.prisma.runnerProfile.findMany({
      where: {
        status: { not: "offline" },
        lastHeartbeatAt: { lt: cutoff },
      },
      select: { id: true },
    });

    if (offlineRunners.length === 0) {
      return;
    }

    const runnerIds = offlineRunners.map((r) => r.id);

    await this.prisma.runnerProfile.updateMany({
      where: { id: { in: runnerIds } },
      data: { status: "offline" },
    });

    const dispatchingSessions = await this.prisma.agentSession.findMany({
      where: {
        status: "dispatching",
        runnerId: { in: runnerIds },
      },
      select: { id: true, runnerId: true },
    });

    for (const session of dispatchingSessions) {
      const maxSeq = await this.prisma.sessionEvent.aggregate({
        where: { sessionId: session.id },
        _max: { seq: true },
      });
      const seq = nextEventSeq(maxSeq._max.seq);

      await this.prisma.$transaction([
        this.prisma.agentSession.update({
          where: { id: session.id },
          data: { status: "queued", runnerId: null },
        }),
        this.prisma.sessionEvent.create({
          data: {
            sessionId: session.id,
            seq,
            type: "runner.released",
            payload: {
              previousRunnerId: session.runnerId,
              reason: "runner_offline_timeout",
            },
          },
        }),
      ]);
    }

    const runningSessions = await this.prisma.agentSession.findMany({
      where: {
        status: "running",
        runnerId: { in: runnerIds },
      },
      include: { workItem: true },
    });

    for (const session of runningSessions) {
      const maxSeq = await this.prisma.sessionEvent.aggregate({
        where: { sessionId: session.id },
        _max: { seq: true },
      });
      const seq = nextEventSeq(maxSeq._max.seq);
      const workItemStatus = workItemStatusFromSessionResult("failed");
      const workItemUpdate: { activeSessionId: null; status?: WorkItemStatus } =
        { activeSessionId: null };
      if (workItemStatus) {
        workItemUpdate.status = workItemStatus;
      }

      await this.prisma.$transaction([
        this.prisma.agentSession.update({
          where: { id: session.id },
          data: { status: "failed", completedAt: new Date() },
        }),
        this.prisma.sessionEvent.create({
          data: {
            sessionId: session.id,
            seq,
            type: "session.failed",
            payload: {
              reason: "runner_offline_timeout",
              previousRunnerId: session.runnerId,
            },
          },
        }),
        ...(session.workItem.activeSessionId === session.id
          ? [
              this.prisma.workItem.update({
                where: { id: session.workItem.id },
                data: workItemUpdate,
              }),
            ]
          : []),
      ]);
    }

    if (dispatchingSessions.length > 0) {
      await this.redis.getClient().set(this.CLAIM_AVAILABLE_KEY, "1");
    }

    for (const runnerId of runnerIds) {
      await this.audit.log(
        "runner.marked_offline",
        runnerId,
        "runner",
        runnerId,
        {
          releasedSessionCount: dispatchingSessions.filter((s) => s.runnerId === runnerId).length,
          failedSessionCount: runningSessions.filter((s) => s.runnerId === runnerId).length,
        },
      );
    }
  }
}
