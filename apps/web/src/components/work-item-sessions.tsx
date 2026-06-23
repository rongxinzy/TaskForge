import Link from "next/link";
import { Session } from "@/lib/types";
import { Status, StatusIndicator, StatusLabel } from "./ui/status";

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

export function WorkItemSessions({ sessions }: { sessions: Session[] }) {
  return (
    <section className="bg-white p-5 rounded-lg shadow border border-gray-200">
      <h2 className="text-md font-semibold text-gray-900">Sessions</h2>
      {sessions.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">No sessions yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100">
          {sessions.map((session) => (
            <li key={session.id}>
              <Link
                href={`/sessions/${session.id}`}
                className="flex items-center justify-between gap-3 py-3 hover:bg-gray-50 -mx-2 px-2 rounded-md transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">
                    Session {session.id.slice(-8)}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {new Date(session.createdAt).toLocaleString()} · /{session.mode}
                    {session.runnerName ? ` · ${session.runnerName}` : null}
                    {session.acpAgentInfoJson?.agentName ? (
                      <span className="text-gray-400">
                        {" "}
                        / {String(session.acpAgentInfoJson.agentName)}
                      </span>
                    ) : null}
                  </div>
                </div>
                <Status status={sessionStatus(session.status)} className="text-xs shrink-0">
                  <StatusIndicator />
                  <StatusLabel>{session.status.replace(/_/g, " ")}</StatusLabel>
                </Status>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
