"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { Session, SessionEvent } from "@/lib/types";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { FileChangeStep } from "./session-steps/file-change-step";
import { VerificationStep } from "./session-steps/verification-step";

const RESUMABLE_STATUSES = new Set([
  "completed",
  "failed",
  "interrupted",
  "awaiting_input",
]);

export function SessionGenerativeUI({
  session,
  initialEvents,
}: {
  session: Session;
  initialEvents: SessionEvent[];
}) {
  const [showRaw, setShowRaw] = useState(false);
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const transportRef = useRef(
    new DefaultChatTransport({
      api: `/api/sessions/${session.id}/ui-stream`,
      credentials: "include",
    })
  );
  const { messages, status, error, sendMessage, stop } = useChat({
    transport: transportRef.current,
    messages: [],
  });

  useEffect(() => {
    sendMessage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  const assistantMessages = messages.filter((m) => m.role === "assistant");
  const isStreaming = status === "streaming";
  const isResumable = RESUMABLE_STATUSES.has(session.status);
  const inputEnabled = !error && session.status !== "cancelled";

  async function handleSubmit(message: PromptInputMessage) {
    const text = message.text?.trim();
    if (!text) return;
    setInputError(null);
    try {
      if (isResumable) {
        await apiFetch(`/api/sessions/${session.id}/resume`, {
          method: "POST",
          body: JSON.stringify({ instruction: text }),
        });
        window.location.reload();
      } else {
        await apiFetch(`/api/sessions/${session.id}/events`, {
          method: "POST",
          body: JSON.stringify({ body: text }),
        });
        setInput("");
      }
    } catch (e) {
      setInputError(e instanceof Error ? e.message : "Failed to send input");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-1.5 flex shrink-0 items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {isStreaming || status === "submitted"
            ? "Streaming agent trace..."
            : status === "error"
              ? "Stream error"
              : "Trace complete"}
        </div>
        <div className="flex items-center gap-2">
          {(isStreaming || status === "submitted") && (
            <Button variant="outline" size="sm" onClick={stop}>
              Stop
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowRaw((s) => !s)}
          >
            {showRaw ? "Hide raw events" : "Show raw events"}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mb-2 shrink-0 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error.message}
        </div>
      ) : null}

      <Conversation className="min-h-0 flex-1 rounded-md border bg-background">
        <ConversationContent className="gap-3 px-4 py-3 pb-20">
          {assistantMessages.length === 0 ? (
            <ConversationEmptyState title="Waiting for agent trace..." />
          ) : (
            assistantMessages.map((message, index) => (
              <AssistantMessage
                key={message.id}
                message={message}
                isLastMessage={index === assistantMessages.length - 1}
                isStreaming={isStreaming}
              />
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="relative z-10 -mt-4 shrink-0 px-2 pb-2">
        <PromptInput
          onSubmit={handleSubmit}
          className="mx-auto max-w-4xl rounded-xl border bg-background shadow-lg"
        >
          <PromptInputBody>
            <PromptInputTextarea
              value={input}
              placeholder={
                session.status === "cancelled"
                  ? "Session cancelled"
                  : isResumable
                    ? "Type to resume session..."
                    : "Send a follow-up to the agent..."
              }
              onChange={(e) => setInput(e.currentTarget.value)}
              disabled={!inputEnabled}
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              {inputError ? (
                <span className="text-xs text-destructive">{inputError}</span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {session.status === "cancelled"
                    ? "Session cancelled"
                    : isResumable
                      ? "Press Enter to resume the session"
                      : "Press Enter to send, Shift+Enter for new line"}
                </span>
              )}
            </PromptInputTools>
            <PromptInputSubmit
              status={status}
              disabled={!inputEnabled || !input.trim()}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>

      {showRaw ? (
        <div className="mt-2 shrink-0 overflow-x-auto rounded-md bg-black p-4 font-mono text-sm text-green-400">
          {initialEvents.length === 0 ? (
            <div className="text-gray-500">No events yet.</div>
          ) : (
            initialEvents.map((evt) => (
              <div
                key={evt.seq}
                className="border-b border-gray-800 py-1 last:border-0"
              >
                <span className="text-gray-500">[{evt.seq}]</span>{" "}
                <span className="text-yellow-400">{evt.type}</span>{" "}
                <span className="text-green-300">
                  {JSON.stringify(evt.payload)}
                </span>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function AssistantMessage({
  message,
  isLastMessage,
  isStreaming,
}: {
  message: UIMessage;
  isLastMessage: boolean;
  isStreaming: boolean;
}) {
  const reasoningParts = message.parts.filter((part) => part.type === "reasoning");
  const reasoningText = reasoningParts
    .map((part) => (part as { text?: string }).text ?? "")
    .join("\n\n");
  const hasReasoning = reasoningParts.length > 0;
  const lastPart = message.parts.at(-1);
  const isReasoningStreaming =
    isLastMessage && isStreaming && lastPart?.type === "reasoning";

  return (
    <Message from={message.role} className="max-w-none">
      <MessageContent className="w-full max-w-none">
        {hasReasoning && (
          <Reasoning isStreaming={isReasoningStreaming}>
            <ReasoningTrigger />
            <ReasoningContent>{reasoningText}</ReasoningContent>
          </Reasoning>
        )}
        {message.parts.map((part, idx) => {
          if (part.type === "reasoning") {
            return null;
          }

          if (part.type === "text") {
            return <MessageResponse key={idx}>{part.text}</MessageResponse>;
          }

          const typedPart = part as {
            type: string;
            input?: Record<string, unknown>;
            output?: Record<string, unknown>;
            state?: string;
            toolName?: string;
            errorText?: string;
          };
          const type = typedPart.type;

          if (type === "tool-applyFileChange") {
            const input = typedPart.input as
              | { path?: string; changeType?: string; diff?: string }
              | undefined;
            if (input?.path) {
              return (
                <FileChangeStep
                  key={idx}
                  path={input.path}
                  changeType={input.changeType ?? "modified"}
                  diff={input.diff ?? ""}
                />
              );
            }
          }

          if (type === "tool-runVerification") {
            const input = typedPart.input as
              | { tool?: string; args?: unknown[] }
              | undefined;
            const output = typedPart.output as
              | { state?: string; output?: unknown }
              | undefined;
            if (input?.tool) {
              return (
                <VerificationStep
                  key={idx}
                  tool={input.tool}
                  args={input.args ?? []}
                  state={
                    output?.state === "passed"
                      ? "passed"
                      : output?.state === "failed"
                        ? "failed"
                        : "running"
                  }
                  output={output?.output}
                />
              );
            }
          }

          if (type.startsWith("tool-") || type === "dynamic-tool") {
            return <GenericToolStep key={idx} part={typedPart} />;
          }

          return (
            <div key={idx} className="text-xs text-muted-foreground">
              [{type}]
            </div>
          );
        })}
      </MessageContent>
    </Message>
  );
}

function GenericToolStep({
  part,
}: {
  part: {
    type: string;
    input?: Record<string, unknown>;
    output?: Record<string, unknown>;
    state?: string;
    toolName?: string;
    errorText?: string;
  };
}) {
  return (
    <Tool
      defaultOpen={
        part.state === "output-available" || part.state === "output-error"
      }
    >
      <ToolHeader
        type={part.type as never}
        state={(part.state as never) ?? "input-available"}
        toolName={part.toolName}
      />
      <ToolContent>
        <ToolInput input={part.input ?? {}} />
        <ToolOutput output={part.output} errorText={part.errorText} />
      </ToolContent>
    </Tool>
  );
}
