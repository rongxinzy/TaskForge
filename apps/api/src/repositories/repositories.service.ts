import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { RepositoryProviderInput } from "@taskforge/contracts";
import { PrismaService } from "../common/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ProjectsService } from "../projects/projects.service";
import { REPOSITORY_PROVIDERS } from "./repositories.constants";
import type { RepositoryProviderMap } from "./repositories.module";

const safeRepositorySelect = {
  id: true,
  projectId: true,
  provider: true,
  url: true,
  defaultBranch: true,
  externalId: true,
  syncStatus: true,
  lastSyncAt: true,
  syncError: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class RepositoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly projects: ProjectsService,
    @Inject(REPOSITORY_PROVIDERS)
    private readonly providers: RepositoryProviderMap,
  ) {}

  async create(
    projectId: string,
    input: RepositoryProviderInput,
    actorId: string,
  ) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      throw new NotFoundException("Project not found");
    }
    await this.projects.requireAccess(actorId, projectId, "maintainer");

    const provider = this.providers[input.provider];
    if (!provider) {
      throw new NotFoundException(
        `Repository provider "${input.provider}" is not configured`,
      );
    }

    const metadata = await provider.fetchMetadata(input);
    const repository = await this.prisma.repository.create({
      data: {
        projectId,
        provider: input.provider,
        url: input.url,
        accessToken: input.accessToken ?? null,
        defaultBranch: input.defaultBranch ?? metadata.defaultBranch ?? null,
        externalId: input.externalId ?? metadata.externalId ?? null,
      },
      select: safeRepositorySelect,
    });

    await this.audit.log(
      "repository.created",
      actorId,
      "repository",
      repository.id,
      { provider: input.provider, url: input.url },
    );
    return repository;
  }

  async listForProject(projectId: string, actorId: string) {
    await this.projects.requireAccess(actorId, projectId, "viewer");
    return this.prisma.repository.findMany({
      where: { projectId },
      select: safeRepositorySelect,
      orderBy: { createdAt: "asc" },
    });
  }
}
