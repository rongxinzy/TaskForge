import { PrismaClient } from "@taskforge/db";
import { Worker, Job, UnrecoverableError, Queue } from "bullmq";
import Redis from "ioredis";
import type { RedisOptions } from "ioredis";
import { OUTBOX_QUEUE, DISPATCH_QUEUE } from "../queue-names";
import { createRedisConnection } from "../redis";

const CLAIM_AVAILABLE_KEY = "runner:claims:available";

type WorkItemLike = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  acceptanceCriteria: string | null;
};

type ContextBundleLike = {
  goal: string | null;
  acceptanceCriteria: string | null;
  promptInput: string | null;
};

function renderPrompt(
  template: string,
  workItem: WorkItemLike,
  contextBundle: ContextBundleLike | null,
): string {
  const goal = contextBundle?.goal ?? workItem.title ?? "";
  const acceptanceCriteria =
    contextBundle?.acceptanceCriteria ?? workItem.acceptanceCriteria ?? "";
  const context = contextBundle?.promptInput ?? "";

  return template
    .replaceAll("{{workItemId}}", workItem.id)
    .replaceAll("{{projectId}}", workItem.projectId)
    .replaceAll("{{goal}}", goal)
    .replaceAll("{{acceptanceCriteria}}", acceptanceCriteria)
    .replaceAll("{{context}}", context)
    .replaceAll("{{title}}", workItem.title)
    .replaceAll("{{description}}", workItem.description ?? "")
    .replaceAll("{{summary}}", contextBundle?.goal ?? workItem.title);
}

function nextSeq(lastSeq: number | null | undefined): number {
  return (lastSeq ?? 0) + 1;
}

export function createOutboxProcessor(
  prisma: PrismaClient,
  redis?: RedisOptions,
): Worker {
  const connection = redis ?? createRedisConnection();
  const dispatchQueue = new Queue(DISPATCH_QUEUE, { connection });
  const flagClient = new Redis(connection);

  return new Worker(
    OUTBOX_QUEUE,
    async (job: Job<{ eventId: string }>) => {
      const { eventId } = job.data;

      const event = await prisma.outboxEvent.findUnique({
        where: { id: eventId },
      });
      if (!event) {
        throw new UnrecoverableError(`OutboxEvent ${eventId} not found`);
      }
      if (event.type !== "prepare_acp_prompt") {
        throw new UnrecoverableError(
          `Unsupported outbox event type: ${event.type}`,
        );
      }
      if (event.status === "done") {
        return;
      }

      await prisma.outboxEvent.update({
        where: { id: eventId },
        data: { status: "processing" },
      });

      try {
        const payload = event.payload as { sessionId?: string };
        const sessionId = payload.sessionId;
        if (!sessionId) {
          throw new UnrecoverableError(
            `OutboxEvent ${eventId} missing sessionId`,
          );
        }

        const session = await prisma.agentSession.findUnique({
          where: { id: sessionId },
          include: { workItem: true, contextBundle: true },
        });
        if (!session) {
          throw new UnrecoverableError(`AgentSession ${sessionId} not found`);
        }

        const promptVersion = await prisma.promptVersion.findFirst({
          where: { mode: session.mode },
          orderBy: { version: "desc" },
        });
        if (!promptVersion) {
          throw new UnrecoverableError(
            `No PromptVersion found for mode ${session.mode}`,
          );
        }

        const rendered = renderPrompt(
          promptVersion.template,
          session.workItem,
          session.contextBundle,
        );

        const nextStatus = session.runnerId ? "dispatching" : "queued";

        const existingInfo = (session.acpAgentInfoJson ?? {}) as Record<
          string,
          unknown
        >;
        const acpAgentInfoJson = {
          ...existingInfo,
          prompt: rendered,
        };

        const lastEvent = await prisma.sessionEvent.findFirst({
          where: { sessionId: session.id },
          orderBy: { seq: "desc" },
          select: { seq: true },
        });
        const seq = nextSeq(lastEvent?.seq);

        await prisma.$transaction([
          prisma.agentSession.update({
            where: { id: session.id },
            data: {
              status: nextStatus,
              acpAgentInfoJson: acpAgentInfoJson as any,
            },
          }),
          prisma.sessionEvent.create({
            data: {
              sessionId: session.id,
              seq,
              type: "runner.dispatched",
              payload: {
                renderedPrompt: rendered,
                outboxEventId: event.id,
                runnerId: session.runnerId ?? null,
              },
            },
          }),
          prisma.outboxEvent.update({
            where: { id: eventId },
            data: { status: "done" },
          }),
        ]);

        await dispatchQueue.add("dispatch", { sessionId: session.id });
        await flagClient.set(CLAIM_AVAILABLE_KEY, "1");
      } catch (err) {
        const retryCount = event.retryCount + 1;
        const isUnrecoverable =
          err instanceof UnrecoverableError || retryCount > 5;

        const backoffMs = Math.min(2 ** retryCount * 1000, 30_000);
        const availableAt = new Date(Date.now() + backoffMs);

        await prisma.outboxEvent.update({
          where: { id: eventId },
          data: {
            status: isUnrecoverable ? "failed" : "pending",
            retryCount,
            availableAt,
          },
        });

        if (isUnrecoverable) {
          const payload = event.payload as { sessionId?: string };
          if (payload.sessionId) {
            const lastEvent = await prisma.sessionEvent.findFirst({
              where: { sessionId: payload.sessionId },
              orderBy: { seq: "desc" },
              select: { seq: true },
            });
            const seq = nextSeq(lastEvent?.seq);

            await prisma.sessionEvent.create({
              data: {
                sessionId: payload.sessionId,
                seq,
                type: "runner.rejected",
                payload: {
                  reason:
                    err instanceof Error ? err.message : "Unknown error",
                  outboxEventId: event.id,
                },
              },
            });

            await prisma.agentSession
              .update({
                where: { id: payload.sessionId },
                data: { status: "failed" },
              })
              .catch(() => {
                // best-effort status update
              });
          }

          throw new UnrecoverableError(
            err instanceof Error ? err.message : "Outbox processing failed",
          );
        }

        throw err;
      }
    },
    { connection },
  );
}
