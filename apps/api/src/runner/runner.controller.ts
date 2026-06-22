import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
} from "@nestjs/common";
import { Response } from "express";
import {
  AppendSessionEventInput,
  CreateRunnerRegistrationTokenInput,
  RunnerHeartbeatInput,
  RunnerRegisterInput,
  RunnerUpInput,
  SetRunnerVisibilityInput,
  UploadArtifactInput,
} from "@taskforge/contracts";
import { ZodBody } from "../common/zod.pipe";
import { ReqUser, RequestUser } from "../auth/req-user.decorator";
import { RunnerService } from "./runner.service";

@Controller("runner")
export class RunnerController {
  constructor(private readonly runner: RunnerService) {}

  @Post("register")
  register(
    @ZodBody(RunnerRegisterInput) input: RunnerRegisterInput,
    @ReqUser() user: RequestUser,
  ) {
    return this.runner.register(input, user.id);
  }

  @Post("tokens")
  createToken(
    @ZodBody(CreateRunnerRegistrationTokenInput) input: CreateRunnerRegistrationTokenInput,
    @ReqUser() user: RequestUser,
  ) {
    return this.runner.createRegistrationToken(user.id, input.projectId);
  }

  @Post("up")
  up(@ZodBody(RunnerUpInput) input: RunnerUpInput) {
    return this.runner.up(input);
  }

  @Get("projects/:projectId")
  findRunners(@Param("projectId") projectId: string, @ReqUser() user: RequestUser) {
    return this.runner.listForProject(projectId, user.id);
  }

  @Post(":id/visibility")
  setVisibility(
    @Param("id") runnerId: string,
    @ZodBody(SetRunnerVisibilityInput) input: SetRunnerVisibilityInput,
    @ReqUser() user: RequestUser,
  ) {
    return this.runner.setVisibility(runnerId, input, user.id);
  }

  @Post("heartbeat")
  @HttpCode(HttpStatus.OK)
  heartbeat(
    @Headers("x-taskforge-runner-id") runnerId: string,
    @ZodBody(RunnerHeartbeatInput) input: RunnerHeartbeatInput,
  ) {
    if (!runnerId) {
      throw new BadRequestException("Missing x-taskforge-runner-id header");
    }
    return this.runner.heartbeat(runnerId, input);
  }

  @Post("sessions/claim")
  async claim(
    @Headers("x-taskforge-runner-id") runnerId: string,
    @Res() res: Response,
  ) {
    if (!runnerId) {
      throw new BadRequestException("Missing x-taskforge-runner-id header");
    }
    const result = await this.runner.claim(runnerId);
    if (!result) {
      res.status(204).send();
      return;
    }
    res.json(result);
  }

  @Post("sessions/:id/events")
  appendEvent(
    @Param("id") sessionId: string,
    @Headers("x-taskforge-runner-id") runnerId: string,
    @ZodBody(AppendSessionEventInput) input: AppendSessionEventInput,
  ) {
    if (!runnerId) {
      throw new BadRequestException("Missing x-taskforge-runner-id header");
    }
    return this.runner.appendEvent(runnerId, sessionId, input);
  }

  @Post("sessions/:id/artifacts")
  uploadArtifact(
    @Param("id") sessionId: string,
    @Headers("x-taskforge-runner-id") runnerId: string,
    @ZodBody(UploadArtifactInput) input: UploadArtifactInput,
  ) {
    if (!runnerId) {
      throw new BadRequestException("Missing x-taskforge-runner-id header");
    }
    return this.runner.uploadArtifact(runnerId, sessionId, input);
  }
}
