import { apiFetch } from "@/lib/api";
import { Session, SessionEvent } from "@/lib/types";
import { SessionGenerativeUI } from "@/components/session-generative-ui";
import { SessionResume } from "@/components/session-resume";
import { Status, StatusIndicator, StatusLabel } from "@/components/ui/status";

function sessionStatus(
  status: Session["status"],
): "online" | "offline" | "maintenance" | "degraded" {
  switch (status) {
    case "running":
    case "completed":
    case "verifying":
      return "online";
    case "created":
    case "context_compiling":
    case "queued":
    case "dispatching":
    case "awaiting_input":
    case "awaiting_approval":
      return "maintenance";
    case "failed":
    case "cancelled":
    case "interrupted":
      return "offline";
    default:
      return "degraded";
  }
}

export default async function SessionPage({
  params,
}: {
  params: { sessionId: string };
}) {
  let session: Session | null = null;
  let events: SessionEvent[] = [];
  let error: string | null = null;

  try {
    [session, events] = await Promise.all([
      apiFetch<Session>(`/api/sessions/${params.sessionId}`),
      apiFetch<SessionEvent[]>(`/api/sessions/${params.sessionId}/events`),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load session";
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (!session) {
    return <div className="text-gray-600">Loading session...</div>;
  }

  const agentName = session.acpAgentInfoJson?.agentName;

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100vh-4.5rem)] flex-col">
      <div className="shrink-0 border-b px-4 py-2">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Status
            </span>
            <Status status={sessionStatus(session.status)} className="text-xs">
              <StatusIndicator />
              <StatusLabel>{session.status.replace(/_/g, " ")}</StatusLabel>
            </Status>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Mode
            </span>
            <span className="font-medium">/{session.mode}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Runner
            </span>
            <span className="font-medium">
              {session.runnerName ?? session.runnerId ?? "Unassigned"}
            </span>
            {agentName ? (
              <span className="text-xs text-muted-foreground">/ {agentName}</span>
            ) : null}
          </div>
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              CWD
            </span>
            <span className="truncate font-mono text-xs">
              {session.workingDirectory ?? "Default"}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden px-4 py-3">
        <SessionResume session={session} events={events} />
        <SessionGenerativeUI session={session} initialEvents={events} />
      </div>
    </div>
  );
}
