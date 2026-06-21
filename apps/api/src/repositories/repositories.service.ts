import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { RepositoryProviderInput } from "@taskforge/contracts";
import { PrismaService } from "../common/prisma.service";
import { AuditService } from "../audit/audit.service";
import {
  REPOSITORY_PROVIDERS,
  RepositoryProviderMap,
} from "./repositories.module";

@Injectable()
export class RepositoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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
        defaultBranch: input.defaultBranch ?? metadata.defaultBranch ?? null,
        externalId: input.externalId ?? metadata.externalId ?? null,
      },
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
}
