import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaModule } from "../common/prisma.module";
import { AuditModule } from "../audit/audit.module";
import { GitHubRepositoryProvider, RepositoryProvider } from "./provider.port";
import { GitLabRepositoryProvider } from "./gitlab.provider";
import { RepositoriesService } from "./repositories.service";
import { RepositoriesController } from "./repositories.controller";
import { REPOSITORY_PROVIDERS } from "./repositories.constants";

export type RepositoryProviderMap = Record<string, RepositoryProvider>;

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [
    RepositoriesService,
    {
      provide: REPOSITORY_PROVIDERS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): RepositoryProviderMap => {
        const gitlabToken = config.get<string>("GITLAB_API_TOKEN");
        const gitlabBaseUrl = config.get<string>("GITLAB_BASE_URL");
        return {
          github: new GitHubRepositoryProvider(),
          ...(gitlabToken && gitlabBaseUrl
            ? {
                gitlab: new GitLabRepositoryProvider({
                  token: gitlabToken,
                  baseUrl: gitlabBaseUrl,
                }),
              }
            : {}),
        };
      },
    },
  ],
  controllers: [RepositoriesController],
})
export class RepositoriesModule {}
