import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  CreateSessionInput,
  HumanInputEventInput,
  ResumeSessionInput,
  UpdateSessionWorkingDirectoryInput,
  type SessionStatus,
  type EventType,
  type WorkItemStatus,
} from "@taskforge/contracts";
import {
  canStartWorkItemSession,
  isSessionActive,
  isSessionTerminal,
  nextEventSeq,
  workItemStatusFromSessionResult,
} from "@taskforge/domain";
import { PrismaService } from "../common/prisma.service";
import { AuditService } from "../audit/audit.service";
import { OutboxService } from "../outbox/outbox.service";
import { ProjectsService } from "../projects/projects.service";

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly projects: ProjectsService,
  ) {}

  async create(input: CreateSessionInput, actorId: string) {
    const workItem = await this.prisma.workItem.findUnique({
      where: { id: input.workItemId },
    });
    if (!workItem) {
      throw new NotFoundException("Work item not found");
    }
    await this.projects.requireAccess(
      actorId,
      workItem.projectId,
      "contributor",
    );

    let resolvedRunner: {
      id: string;
      name: string;
      ownerId: string;
      projectId: string | null;
      agents: { name: string }[];
      visibilities: { visible: boolean }[];
    } | null = null;
    if (input.runnerId) {
      resolvedRunner = await this.prisma.runnerProfile.findUnique({
        where: { id: input.runnerId },
        include: {
          agents: { select: { name: true } },
          visibilities: {
            where: { projectId: workItem.projectId },
            take: 1,
          },
        },
      });
      if (!resolvedRunner) {
        throw new NotFoundException("Runner not found");
      }
      if (resolvedRunner.ownerId !== actorId) {
        throw new ForbiddenException("Runner does not belong to you");
      }
      if (
        resolvedRunner.projectId &&
        resolvedRunner.projectId !== workItem.projectId
      ) {
        throw new BadRequestException(
          "Runner is not available in this project",
        );
      }
      const visibility = resolvedRunner.visibilities[0];
      if (visibility && !visibility.visible) {
        throw new BadRequestException(
          "Runner is not visible in this project",
        );
      }
      if (input.agentName) {
        const found = resolvedRunner.agents.some(
          (a) => a.name === input.agentName,
        );
        if (!found) {
          throw new BadRequestException(
            `Agent ${input.agentName} is not available on this runner`,
          );
        }
      }
    }

    let outboxEventId: string | undefined;

    const result = await this.prisma.$transaction(async (tx) => {
      const workItemInTx = await tx.workItem.findUnique({
        where: { id: input.workItemId },
      });
      if (!workItemInTx) {
        throw new NotFoundException("Work item not found");
      }
      if (
        !canStartWorkItemSession(
          workItemInTx.status as WorkItemStatus,
          workItemInTx.activeSessionId,
        )
      ) {
        throw new BadRequestException(
          "Cannot start a session for this work item",
        );
      }

      let bundle = await tx.contextBundle.findFirst({
        where: { workItemId: workItemInTx.id },
        orderBy: { version: "desc" },
      });
      if (!bundle) {
        bundle = await this.compileBundleInTx(tx, workItemInTx);
      }

      const acpAgentInfoJson = resolvedRunner
        ? {
            runnerId: resolvedRunner.id,
            runnerName: resolvedRunner.name,
            agentName: input.agentName ?? null,
          }
        : null;

      const session = await tx.agentSession.create({
        data: {
          workItemId: workItemInTx.id,
          contextBundleId: bundle!.id,
          mode: input.mode,
          status: "created",
          runnerId: input.runnerId ?? null,
          workingDirectory: input.workingDirectory ?? null,
          acpAgentInfoJson: acpAgentInfoJson as any,
        },
      });

      await tx.sessionEvent.createMany({
        data: [
          {
            sessionId: session.id,
            seq: 1,
            type: "session.created",
            payload: {
              instruction: input.instruction ?? null,
              actorId,
            },
          },
          {
            sessionId: session.id,
            seq: 2,
            type: "context.compiled",
            payload: { contextBundleId: bundle!.id },
          },
        ],
      });

      await tx.workItem.update({
        where: { id: workItemInTx.id },
        data: { status: "in_progress", activeSessionId: session.id },
      });

      const outboxEvent = await tx.outboxEvent.create({
        data: {
          type: "prepare_acp_prompt",
          payload: { sessionId: session.id },
          status: "pending",
        },
      });
      outboxEventId = outboxEvent.id;

      await tx.auditLog.create({
        data: {
          action: "session.created",
          actorId,
          targetType: "session",
          targetId: session.id,
          payload: { workItemId: workItemInTx.id, mode: input.mode },
        },
      });

      return tx.agentSession.findUnique({
        where: { id: session.id },
        include: {
          events: { orderBy: { seq: "asc" } },
          workItem: true,
          contextBundle: true,
          runner: true,
        },
      });
    });

    if (outboxEventId) {
      const enqueued = await this.outbox.enqueueJob(outboxEventId);
      if (!enqueued) {
        // BullMQ disabled; process outbox synchronously so Runner can claim.
        if (result?.id) {
          await this.outbox.processPrepareAcpPrompt(result.id);
        }
      }
    }

    return result;
  }

  async findOne(id: string, actorId: string) {
    const session = await this.prisma.agentSession.findUnique({
      where: { id },
      include: {
        events: { orderBy: { seq: "asc" } },
        workItem: { include: { project: true } },
        contextBundle: true,
        runner: true,
      },
    });
    if (!session) {
      throw new NotFoundException("Session not found");
    }
    await this.projects.requireAccess(
      actorId,
      session.workItem.projectId,
      "viewer",
    );
    return session;
  }

  async requireAccess(id: string, actorId: string) {
    const session = await this.prisma.agentSession.findUnique({
      where: { id },
      include: { workItem: true },
    });
    if (!session) {
      throw new NotFoundException("Session not found");
    }
    await this.projects.requireAccess(
      actorId,
      session.workItem.projectId,
      "viewer",
    );
  }

  async findEvents(id: string, actorId: string, afterSeq?: number) {
    const session = await this.prisma.agentSession.findUnique({
      where: { id },
      include: { workItem: true },
    });
    if (!session) {
      throw new NotFoundException("Session not found");
    }
    await this.projects.requireAccess(
      actorId,
      session.workItem.projectId,
      "viewer",
    );
    return this.prisma.sessionEvent.findMany({
      where: {
        sessionId: id,
        ...(afterSeq !== undefined ? { seq: { gt: afterSeq } } : {}),
      },
      orderBy: { seq: "asc" },
    });
  }

  async appendHumanInput(
    id: string,
    input: HumanInputEventInput,
    actorId: string,
  ) {
    const session = await this.prisma.agentSession.findUnique({
      where: { id },
      include: { workItem: true },
    });
    if (!session) {
      throw new NotFoundException("Session not found");
    }
    await this.projects.requireAccess(
      actorId,
      session.workItem.projectId,
      "contributor",
    );

    return this.prisma.$transaction(async (tx) => {
      const sessionInTx = await tx.agentSession.findUnique({ where: { id } });
      if (!sessionInTx) {
        throw new NotFoundException("Session not found");
      }
      const maxSeq = await tx.sessionEvent.aggregate({
        where: { sessionId: id },
        _max: { seq: true },
      });
      const seq = nextEventSeq(maxSeq._max.seq);
      const event = await tx.sessionEvent.create({
        data: {
          sessionId: id,
          seq,
          type: "human.input",
          payload: { body: input.body, actorId },
        },
      });
      if (sessionInTx.status === "awaiting_input") {
        await tx.agentSession.update({
          where: { id },
          data: { status: "running" },
        });
      }
      return event;
    });
  }

  async resume(id: string, input: ResumeSessionInput, actorId: string) {
    const session = await this.prisma.agentSession.findUnique({
      where: { id },
      include: { workItem: true },
    });
    if (!session) {
      throw new NotFoundException("Session not found");
    }
    await this.projects.requireAccess(
      actorId,
      session.workItem.projectId,
      "contributor",
    );

    const resumable: SessionStatus[] = [
      "completed",
      "failed",
      "interrupted",
      "awaiting_input",
    ];
    if (!resumable.includes(session.status as SessionStatus)) {
      throw new BadRequestException(
        `Cannot resume session in status ${session.status}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const sessionInTx = await tx.agentSession.findUnique({ where: { id } });
      if (!sessionInTx) {
        throw new NotFoundException("Session not found");
      }
      const maxSeq = await tx.sessionEvent.aggregate({
        where: { sessionId: id },
        _max: { seq: true },
      });
      let seq = nextEventSeq(maxSeq._max.seq);

      if (input.instruction?.trim()) {
        await tx.sessionEvent.create({
          data: {
            sessionId: id,
            seq,
            type: "human.input",
            payload: { body: input.instruction.trim(), actorId },
          },
        });
        seq = nextEventSeq(seq);
      }

      await tx.sessionEvent.create({
        data: {
          sessionId: id,
          seq,
          type: "runner.dispatched",
          payload: { reason: "resume", actorId },
        },
      });

      const updateData: {
        status: SessionStatus;
        runnerId: null;
        workingDirectory?: string;
      } = {
        status: "dispatching",
        runnerId: null,
      };
      if (input.workingDirectory) {
        updateData.workingDirectory = input.workingDirectory;
      }

      await tx.agentSession.update({
        where: { id },
        data: updateData,
      });

      await tx.workItem.update({
        where: { id: session.workItem.id },
        data: { status: "in_progress", activeSessionId: session.id },
      });

      await tx.auditLog.create({
        data: {
          action: "session.resumed",
          actorId,
          targetType: "session",
          targetId: id,
          payload: {
            workingDirectory: input.workingDirectory ?? null,
            instruction: input.instruction ?? null,
          },
        },
      });

      return tx.agentSession.findUnique({
        where: { id },
        include: {
          events: { orderBy: { seq: "asc" } },
          workItem: true,
          contextBundle: true,
          runner: true,
        },
      });
    });
  }

  async updateWorkingDirectory(
    id: string,
    input: UpdateSessionWorkingDirectoryInput,
    actorId: string,
  ) {
    const session = await this.prisma.agentSession.findUnique({
      where: { id },
      include: { workItem: true },
    });
    if (!session) {
      throw new NotFoundException("Session not found");
    }
    await this.projects.requireAccess(
      actorId,
      session.workItem.projectId,
      "contributor",
    );

    return this.prisma.agentSession.update({
      where: { id },
      data: { workingDirectory: input.workingDirectory },
    });
  }

  async stop(
    id: string,
    input: { reason?: string; finalStatus?: SessionStatus },
    actorId: string,
  ) {
    const finalStatus = (input.finalStatus ?? "cancelled") as SessionStatus;
    if (!isSessionTerminal(finalStatus)) {
      throw new BadRequestException("finalStatus must be terminal");
    }

    const session = await this.prisma.agentSession.findUnique({
      where: { id },
      include: { workItem: true },
    });
    if (!session) {
      throw new NotFoundException("Session not found");
    }
    await this.projects.requireAccess(
      actorId,
      session.workItem.projectId,
      "contributor",
    );
    if (!isSessionActive(session.status as SessionStatus)) {
      throw new BadRequestException("Session is not active");
    }

    return this.prisma.$transaction(async (tx) => {
      const sessionInTx = await tx.agentSession.findUnique({
        where: { id },
        include: { workItem: true },
      });
      if (!sessionInTx) {
        throw new NotFoundException("Session not found");
      }

      const maxSeq = await tx.sessionEvent.aggregate({
        where: { sessionId: id },
        _max: { seq: true },
      });
      const seq = nextEventSeq(maxSeq._max.seq);
      const eventType = `session.${finalStatus}` as EventType;

      await tx.sessionEvent.create({
        data: {
          sessionId: id,
          seq,
          type: eventType,
          payload: { reason: input.reason ?? null, actorId },
        },
      });

      await tx.agentSession.update({
        where: { id },
        data: { status: finalStatus, completedAt: new Date() },
      });

      const workItemStatus = workItemStatusFromSessionResult(finalStatus);
      const workItemUpdate: { activeSessionId: null; status?: WorkItemStatus } =
        { activeSessionId: null };
      if (workItemStatus) {
        workItemUpdate.status = workItemStatus;
      }
      if (sessionInTx.workItem.activeSessionId === id) {
        await tx.workItem.update({
          where: { id: sessionInTx.workItem.id },
          data: workItemUpdate,
        });
      }

      await tx.auditLog.create({
        data: {
          action: "session.stopped",
          actorId,
          targetType: "session",
          targetId: id,
          payload: { finalStatus, reason: input.reason },
        },
      });

      return tx.agentSession.findUnique({
        where: { id },
        include: { events: { orderBy: { seq: "asc" } } },
      });
    });
  }

  private async compileBundleInTx(
    tx: any,
    workItem: {
      id: string;
      title: string;
      description: string | null;
      acceptanceCriteria: string | null;
    },
  ) {
    const latestPrompt = await tx.promptVersion.findFirst({
      where: { mode: "goal" },
      orderBy: { version: "desc" },
    });
    const maxVersion = await tx.contextBundle.aggregate({
      where: { workItemId: workItem.id },
      _max: { version: true },
    });
    const nextVersion = (maxVersion._max.version ?? 0) + 1;
    // promptInput holds additional context (file paths, notes) that the prompt
    // template injects under {{context}}. The template itself already provides
    // the task structure, so we keep this field minimal to avoid duplication.
    const promptInput = "";

    return tx.contextBundle.create({
      data: {
        workItemId: workItem.id,
        version: nextVersion,
        summary: workItem.title,
        goal: workItem.description ?? "",
        acceptanceCriteria: workItem.acceptanceCriteria ?? "",
        promptInput,
      },
    });
  }
}
