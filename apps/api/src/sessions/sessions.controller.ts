import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { Response } from "express";
import { SessionEvent } from "@prisma/client";
import {
  CreateSessionInput,
  HumanInputEventInput,
  ResumeSessionInput,
  UpdateSessionWorkingDirectoryInput,
  type SessionStatus,
} from "@taskforge/contracts";
import { isSessionTerminal } from "@taskforge/domain";
import { generateId, pipeUIMessageStreamToResponse } from "ai";
import { ZodBody } from "../common/zod.pipe";
import { ReqUser, RequestUser } from "../auth/req-user.decorator";
import { SessionsService } from "./sessions.service";

@Controller("sessions")
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post()
  create(
    @ZodBody(CreateSessionInput) input: CreateSessionInput,
    @ReqUser() user: RequestUser,
  ) {
    return this.sessions.create(input, user.id);
  }

  @Get(":id")
  findOne(@Param("id") id: string, @ReqUser() user: RequestUser) {
    return this.sessions.findOne(id, user.id);
  }

  @Get(":id/events")
  findEvents(
    @Param("id") id: string,
    @ReqUser() user: RequestUser,
    @Query("afterSeq") afterSeq?: string,
  ) {
    return this.sessions.findEvents(
      id,
      user.id,
      afterSeq === undefined ? undefined : Number(afterSeq),
    );
  }

  @Get(":id/events/stream")
  async stream(
    @Param("id") id: string,
    @Query("afterSeq") afterSeq: string | undefined,
    @Res() res: Response,
    @ReqUser() user: RequestUser,
  ) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.write("retry: 500\n\n");

    let lastSeq = afterSeq ? Number(afterSeq) : 0;
    while (!res.destroyed) {
      const events = await this.sessions.findEvents(
        id,
        user.id,
        lastSeq || undefined,
      );
      for (const event of events) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        if (event.seq > lastSeq) {
          lastSeq = event.seq;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  @Post(":id/events")
  appendHumanInput(
    @Param("id") id: string,
    @ZodBody(HumanInputEventInput) input: HumanInputEventInput,
    @ReqUser() user: RequestUser,
  ) {
    return this.sessions.appendHumanInput(id, input, user.id);
  }

  @Post(":id/resume")
  @HttpCode(HttpStatus.OK)
  resume(
    @Param("id") id: string,
    @ZodBody(ResumeSessionInput) input: ResumeSessionInput,
    @ReqUser() user: RequestUser,
  ) {
    return this.sessions.resume(id, input, user.id);
  }

  @Post(":id/working-directory")
  @HttpCode(HttpStatus.OK)
  updateWorkingDirectory(
    @Param("id") id: string,
    @ZodBody(UpdateSessionWorkingDirectoryInput)
    input: UpdateSessionWorkingDirectoryInput,
    @ReqUser() user: RequestUser,
  ) {
    return this.sessions.updateWorkingDirectory(id, input, user.id);
  }

  @Post(":id/stop")
  @HttpCode(HttpStatus.OK)
  stop(
    @Param("id") id: string,
    @Body() input: { reason?: string; finalStatus?: SessionStatus },
    @ReqUser() user: RequestUser,
  ) {
    return this.sessions.stop(id, input, user.id);
  }

  @Post(":id/ui-stream")
  async uiStream(
    @Param("id") id: string,
    @Res() res: Response,
    @ReqUser() user: RequestUser,
  ) {
    await this.sessions.requireAccess(id, user.id);

    const sessions = this.sessions;
    const verificationToolCallIds = new Map<string, string[]>();
    const stream = new ReadableStream<unknown>({
      async start(controller) {
        let lastSeq = 0;
        let done = false;
        try {
          while (!done) {
            const events = await sessions.findEvents(
              id,
              user.id,
              lastSeq || undefined,
            );
            for (const event of events) {
              emitSessionEvent(controller, event, verificationToolCallIds);
              lastSeq = event.seq;
              if (isTerminalEventType(event.type)) {
                done = true;
              }
            }
            if (done) break;
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        } catch (err) {
          controller.error(err);
          return;
        }
        controller.close();
      },
    });

    pipeUIMessageStreamToResponse({ response: res, stream: stream as any });
  }
}

function isTerminalEventType(type: string): boolean {
  return (
    type === "session.completed" ||
    type === "session.failed" ||
    type === "session.cancelled" ||
    type === "session.interrupted"
  );
}

function emitSessionEvent(
  controller: ReadableStreamDefaultController<unknown>,
  event: SessionEvent,
  verificationToolCallIds: Map<string, string[]>,
) {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  switch (event.type) {
    case "agent.message": {
      const id = generateId();
      const text = String(payload.text ?? "");
      controller.enqueue({ type: "text-start", id });
      controller.enqueue({ type: "text-delta", id, delta: text });
      controller.enqueue({ type: "text-end", id });
      break;
    }
    case "agent.thinking": {
      const id = generateId();
      const text = String(payload.text ?? "");
      controller.enqueue({ type: "reasoning-start", id });
      controller.enqueue({ type: "reasoning-delta", id, delta: text });
      controller.enqueue({ type: "reasoning-end", id });
      break;
    }
    case "tool.call": {
      const toolCallId = String(payload.toolCallId ?? event.id);
      const toolName = String(payload.toolName ?? "unknown");
      const args = payload.args ?? payload.arguments ?? {};
      controller.enqueue({
        type: "tool-input-start",
        toolCallId,
        toolName,
        dynamic: false,
      });
      controller.enqueue({
        type: "tool-input-available",
        toolCallId,
        toolName,
        input: args,
      });
      break;
    }
    case "tool.call_update": {
      const toolCallId = String(payload.toolCallId ?? event.id);
      controller.enqueue({
        type: "tool-output-available",
        toolCallId,
        output: payload,
      });
      break;
    }
    case "file.changed": {
      const toolCallId = event.id;
      const input = {
        path: String(payload.path ?? ""),
        changeType: String(payload.change_type ?? "modified"),
        diff: String(payload.diff ?? ""),
      };
      controller.enqueue({
        type: "tool-input-start",
        toolCallId,
        toolName: "applyFileChange",
        dynamic: false,
      });
      controller.enqueue({
        type: "tool-input-available",
        toolCallId,
        toolName: "applyFileChange",
        input,
      });
      controller.enqueue({
        type: "tool-output-available",
        toolCallId,
        output: { applied: true },
      });
      break;
    }
    case "verification.started": {
      const toolCallId = event.id;
      const input = {
        tool: String(payload.tool ?? ""),
        args: payload.args ?? [],
      };
      const pending = verificationToolCallIds.get(input.tool) ?? [];
      pending.push(toolCallId);
      verificationToolCallIds.set(input.tool, pending);
      controller.enqueue({
        type: "tool-input-start",
        toolCallId,
        toolName: "runVerification",
        dynamic: false,
      });
      controller.enqueue({
        type: "tool-input-available",
        toolCallId,
        toolName: "runVerification",
        input,
      });
      break;
    }
    case "verification.passed":
    case "verification.failed": {
      const tool = String(payload.tool ?? "");
      const pending = verificationToolCallIds.get(tool) ?? [];
      const toolCallId =
        pending.shift() ?? String(payload.toolCallId ?? event.id);
      if (pending.length === 0) {
        verificationToolCallIds.delete(tool);
      }
      controller.enqueue({
        type: "tool-output-available",
        toolCallId,
        output: {
          state: event.type === "verification.passed" ? "passed" : "failed",
          output: payload,
        },
      });
      break;
    }
    case "session.started":
    case "session.completed":
    case "session.failed":
    case "session.cancelled":
    case "session.interrupted":
    case "runner.dispatched":
    case "runner.accepted":
    case "runner.working_directory_missing":
    case "command.started":
    case "command.output":
    case "command.finished":
    case "session.created":
    case "context.compiled": {
      const id = generateId();
      const text = formatTraceText(event);
      controller.enqueue({ type: "text-start", id });
      controller.enqueue({ type: "text-delta", id, delta: text });
      controller.enqueue({ type: "text-end", id });
      break;
    }
    default: {
      const id = generateId();
      const text = `[${event.type}] ${JSON.stringify(payload)}`;
      controller.enqueue({ type: "text-start", id });
      controller.enqueue({ type: "text-delta", id, delta: text });
      controller.enqueue({ type: "text-end", id });
    }
  }
}

function formatTraceText(event: SessionEvent): string {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  switch (event.type) {
    case "session.created":
      return "Session created";
    case "context.compiled":
      return "Context compiled";
    case "runner.dispatched":
      return `Runner dispatched: ${payload.runnerId ?? "unknown"}`;
    case "runner.accepted":
      return `Runner accepted: ${payload.runnerId ?? "unknown"}`;
    case "runner.working_directory_missing":
      return `Working directory missing: ${payload.path ?? ""}`;
    case "session.started":
      return "Session started";
    case "session.completed":
      return `Session completed: ${JSON.stringify(payload.outcome ?? "success")}`;
    case "session.failed":
      return `Session failed: ${payload.reason ?? ""}`;
    case "session.cancelled":
      return "Session cancelled";
    case "session.interrupted":
      return "Session interrupted";
    case "command.started":
      return `Command started: ${payload.command ?? ""}`;
    case "command.output":
      return `Command output: ${payload.stdout ?? ""}${payload.stderr ?? ""}`;
    case "command.finished":
      return `Command finished with exit code ${payload.exit_code ?? "?"}`;
    default:
      return `[${event.type}]`;
  }
}


