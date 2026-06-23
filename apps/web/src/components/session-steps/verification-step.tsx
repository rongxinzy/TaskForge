"use client";

import {
  Terminal,
  TerminalHeader,
  TerminalTitle,
  TerminalActions,
  TerminalCopyButton,
  TerminalContent,
} from "@/components/ai-elements/terminal";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
} from "@/components/ai-elements/tool";
import { CheckCircle2Icon, XCircleIcon, Loader2Icon } from "lucide-react";

export function VerificationStep({
  tool,
  args,
  state,
  output,
}: {
  tool: string;
  args: unknown[];
  state: "running" | "passed" | "failed";
  output?: unknown;
}) {
  const outputText =
    typeof output === "string"
      ? output
      : JSON.stringify(output ?? null, null, 2);

  const stateLabel = state === "passed" ? "Passed" : state === "failed" ? "Failed" : "Running";
  const StateIcon =
    state === "passed" ? CheckCircle2Icon : state === "failed" ? XCircleIcon : Loader2Icon;

  return (
    <Tool defaultOpen>
      <ToolHeader
        type="tool-runVerification"
        state={
          state === "failed"
            ? "output-error"
            : state === "running"
              ? "input-available"
              : "output-available"
        }
        title={`Verification: ${tool}`}
      />
      <ToolContent>
        <div className="flex items-center gap-2 text-sm">
          <StateIcon
            className={`size-4 ${
              state === "running" ? "animate-spin text-muted-foreground" : ""
            }`}
          />
          <span className="font-medium">{stateLabel}</span>
        </div>
        <ToolInput input={{ tool, args }} />
        <Terminal output={outputText} isStreaming={state === "running"}>
          <TerminalHeader>
            <TerminalTitle>Output</TerminalTitle>
            <TerminalActions>
              <TerminalCopyButton />
            </TerminalActions>
          </TerminalHeader>
          <TerminalContent />
        </Terminal>
      </ToolContent>
    </Tool>
  );
}
