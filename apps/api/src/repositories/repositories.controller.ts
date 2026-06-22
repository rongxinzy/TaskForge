import { Controller, Get, Param, Post } from "@nestjs/common";
import { RepositoryProviderInput } from "@taskforge/contracts";
import { ZodBody } from "../common/zod.pipe";
import { ReqUser, RequestUser } from "../auth/req-user.decorator";
import { RepositoriesService } from "./repositories.service";

@Controller("projects/:projectId/repositories")
export class RepositoriesController {
  constructor(private readonly repositories: RepositoriesService) {}

  @Post()
  create(
    @Param("projectId") projectId: string,
    @ZodBody(RepositoryProviderInput) input: RepositoryProviderInput,
    @ReqUser() user: RequestUser,
  ) {
    return this.repositories.create(projectId, input, user.id);
  }

  @Get()
  findMany(
    @Param("projectId") projectId: string,
    @ReqUser() user: RequestUser,
  ) {
    return this.repositories.listForProject(projectId, user.id);
  }
}
