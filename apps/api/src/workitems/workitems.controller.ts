import { Controller, Get, Param, Patch, Post } from "@nestjs/common";
import {
  CreateWorkItemInput,
  UpdateWorkItemStatusInput,
} from "@taskforge/contracts";
import { ZodBody } from "../common/zod.pipe";
import { ReqUser, RequestUser } from "../auth/req-user.decorator";
import { WorkItemsService } from "./workitems.service";

@Controller("work-items")
export class WorkItemsController {
  constructor(private readonly workItems: WorkItemsService) {}

  @Post()
  create(
    @ZodBody(CreateWorkItemInput) input: CreateWorkItemInput,
    @ReqUser() user: RequestUser,
  ) {
    return this.workItems.create(input, user.id);
  }

  @Get(":id")
  findOne(@Param("id") id: string, @ReqUser() user: RequestUser) {
    return this.workItems.findOne(id, user.id);
  }

  @Get(":id/sessions")
  findSessions(@Param("id") id: string, @ReqUser() user: RequestUser) {
    return this.workItems.findSessions(id, user.id);
  }

  @Patch(":id/status")
  updateStatus(
    @Param("id") id: string,
    @ZodBody(UpdateWorkItemStatusInput)
    input: UpdateWorkItemStatusInput,
    @ReqUser() user: RequestUser,
  ) {
    return this.workItems.updateStatus(id, input, user.id);
  }

  @Post(":id/context-bundles")
  compileContextBundle(
    @Param("id") id: string,
    @ReqUser() user: RequestUser,
  ) {
    return this.workItems.compileContextBundle(id, user.id);
  }
}
