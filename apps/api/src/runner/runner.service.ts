import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AppendSessionEventInput,
  RunnerHeartbeatInput,
  RunnerRegisterInput,
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
import { AuditService } from "../audit/audit.service";
import { OutboxService } from "../outbox/outbox.service";
import { ProjectsService } from "../projects/projects.service";

const EVENT_TO_SESSION_STATUS: Partial<Record<EventType, SessionStatus>> = {
  "session.started": "running",
  "runner.accepted": "running",
  "runner.dispatched": "dispatching",
  "session.awaiting_input": "awaiting_input",
  "approval.requested": "awaiting_approval",
  "verification.started": "verifying",
  "session.completed": "completed",
  "session.failed": "failed",
  "session.cancelled": "cancelled",
  "session.interrupted": "interrupted",
};

@Injectable()
export class RunnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly projects: ProjectsService,
  ) {}

  async register(input: RunnerRegisterInput, actorId: string) {
    if (input.projectId) {
      await this.projects.requireAccess(actorId, input.projectId, "contributor");
    }

    const token = crypto.randomUUID();
    const runner = await this.prisma.runnerProfile.create({
      data: {
        ownerId: actorId,
        projectId: input.projectId ?? null,
        name: input.name,
        adapter: input.adapter ?? null,
        status: "online",
        scope: input.scope ?? "personal",
        capabilities: (input.capabilities ?? {}) as any,
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
    await this.audit.log("runner.registered", actorId, "runner", runner.id, {
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
      include: {
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

      const agentInfo = (session.acpAgentInfoJson ?? {}) as Record<string, string | null>;
      const acp = {
        sessionId: session.id,
        workItemId: session.workItemId,
        projectId: session.workItem.projectId,
        repositoryId: session.workItem.repositoryId ?? null,
        mode: session.mode,
        agentName: agentInfo.agentName ?? null,
        content: `ACP prompt for ${session.mode}: ${
          session.contextBundle?.promptInput ??
          session.workItem.description ??
          ""
        }`,
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
}
