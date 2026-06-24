import { Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import {
  CreateWorkItemCommentInput,
  CreateWorkItemInput,
  UpdateWorkItemCommentInput,
  UpdateWorkItemInput,
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

  @Patch(":id")
  update(
    @Param("id") id: string,
    @ZodBody(UpdateWorkItemInput) input: UpdateWorkItemInput,
    @ReqUser() user: RequestUser,
  ) {
    return this.workItems.update(id, input, user.id);
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

  @Post(":id/comments")
  createComment(
    @Param("id") id: string,
    @ZodBody(CreateWorkItemCommentInput)
    input: CreateWorkItemCommentInput,
    @ReqUser() user: RequestUser,
  ) {
    return this.workItems.createComment(id, input, user.id);
  }

  @Get(":id/comments")
  findComments(@Param("id") id: string, @ReqUser() user: RequestUser) {
    return this.workItems.findComments(id, user.id);
  }

  @Patch(":id/comments/:commentId")
  updateComment(
    @Param("id") id: string,
    @Param("commentId") commentId: string,
    @ZodBody(UpdateWorkItemCommentInput)
    input: UpdateWorkItemCommentInput,
    @ReqUser() user: RequestUser,
  ) {
    return this.workItems.updateComment(id, commentId, input, user.id);
  }

  @Delete(":id/comments/:commentId")
  deleteComment(
    @Param("id") id: string,
    @Param("commentId") commentId: string,
    @ReqUser() user: RequestUser,
  ) {
    return this.workItems.deleteComment(id, commentId, user.id);
  }

  @Post(":id/context-bundles")
  compileContextBundle(
    @Param("id") id: string,
    @ReqUser() user: RequestUser,
  ) {
    return this.workItems.compileContextBundle(id, user.id);
  }
}
