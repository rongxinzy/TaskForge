import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  CreateWorkItemInput,
  UpdateWorkItemStatusInput,
  type WorkItemStatus,
} from "@taskforge/contracts";
import { canTransitionWorkItem } from "@taskforge/domain";
import { PrismaService } from "../common/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ProjectsService } from "../projects/projects.service";

@Injectable()
export class WorkItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly projects: ProjectsService,
  ) {}

  async create(input: CreateWorkItemInput, actorId: string) {
    await this.projects.requireAccess(actorId, input.projectId, "contributor");

    const workItem = await this.prisma.workItem.create({
      data: { ...input, status: "backlog" },
    });
    await this.audit.log("workitem.created", actorId, "workitem", workItem.id, {
      title: input.title,
      type: input.type,
    });
    return workItem;
  }

  async findOne(id: string, actorId: string) {
    const workItem = await this.prisma.workItem.findUnique({
      where: { id },
      include: {
        project: true,
        activeSession: { include: { runner: true } },
        contextBundles: { orderBy: { version: "desc" }, take: 1 },
      },
    });
    if (!workItem) {
      throw new NotFoundException("Work item not found");
    }
    await this.projects.requireAccess(actorId, workItem.projectId, "viewer");
    return workItem;
  }

  async findSessions(id: string, actorId: string) {
    const workItem = await this.prisma.workItem.findUnique({
      where: { id },
      select: { projectId: true },
    });
    if (!workItem) {
      throw new NotFoundException("Work item not found");
    }
    await this.projects.requireAccess(actorId, workItem.projectId, "viewer");

    const sessions = await this.prisma.agentSession.findMany({
      where: { workItemId: id },
      include: { runner: true },
      orderBy: { createdAt: "desc" },
    });

    return sessions.map((s) => ({
      id: s.id,
      workItemId: s.workItemId,
      status: s.status,
      mode: s.mode,
      workingDirectory: s.workingDirectory,
      runnerId: s.runnerId,
      runnerName: s.runner?.name ?? null,
      acpAgentInfoJson: (s.acpAgentInfoJson ?? {}) as Record<string, unknown>,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  }

  async updateStatus(
    id: string,
    input: UpdateWorkItemStatusInput,
    actorId: string,
  ) {
    const workItem = await this.prisma.workItem.findUnique({ where: { id } });
    if (!workItem) {
      throw new NotFoundException("Work item not found");
    }
    await this.projects.requireAccess(
      actorId,
      workItem.projectId,
      "contributor",
    );
    if (
      !canTransitionWorkItem(
        workItem.status as WorkItemStatus,
        input.status,
      )
    ) {
      throw new BadRequestException(
        `Cannot transition work item from ${workItem.status} to ${input.status}`,
      );
    }
    const updated = await this.prisma.workItem.update({
      where: { id },
      data: { status: input.status },
    });
    await this.audit.log(
      "workitem.status_changed",
      actorId,
      "workitem",
      id,
      { from: workItem.status, to: input.status, reason: input.reason },
    );
    return updated;
  }

  async compileContextBundle(id: string, actorId: string) {
    const workItem = await this.prisma.workItem.findUnique({ where: { id } });
    if (!workItem) {
      throw new NotFoundException("Work item not found");
    }
    await this.projects.requireAccess(
      actorId,
      workItem.projectId,
      "contributor",
    );

    const latestPrompt = await this.prisma.promptVersion.findFirst({
      where: { mode: "goal" },
      orderBy: { version: "desc" },
    });

    const maxVersion = await this.prisma.contextBundle.aggregate({
      where: { workItemId: id },
      _max: { version: true },
    });
    const nextVersion = (maxVersion._max.version ?? 0) + 1;

    const promptInput = this.renderPrompt(
      latestPrompt?.template ?? "",
      workItem,
    );

    await this.prisma.contextBundle.updateMany({
      where: { workItemId: id, staleAt: null },
      data: { staleAt: new Date() },
    });

    const bundle = await this.prisma.contextBundle.create({
      data: {
        workItemId: id,
        version: nextVersion,
        summary: workItem.title,
        goal: workItem.description ?? "",
        acceptanceCriteria: workItem.acceptanceCriteria ?? "",
        promptInput,
      },
    });

    await this.audit.log(
      "contextbundle.compiled",
      actorId,
      "contextbundle",
      bundle.id,
      { workItemId: id, version: nextVersion },
    );
    return bundle;
  }

  private renderPrompt(
    template: string,
    workItem: {
      title: string;
      description: string | null;
      acceptanceCriteria: string | null;
    },
  ) {
    return template
      .replace(/{{title}}/g, workItem.title)
      .replace(/{{description}}/g, workItem.description ?? "")
      .replace(
        /{{acceptanceCriteria}}/g,
        workItem.acceptanceCriteria ?? "",
      );
  }
}
