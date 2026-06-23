import { apiFetch } from "@/lib/api";
import { Session, WorkItem } from "@/lib/types";
import { StatusSelect } from "@/components/status-select";
import { StartSessionForm } from "@/components/start-session-form";
import { WorkItemSessions } from "@/components/work-item-sessions";

export default async function WorkItemPage({
  params,
}: {
  params: { id: string; workItemId: string };
}) {
  let workItem: WorkItem | null = null;
  let sessions: Session[] = [];
  let error: string | null = null;

  try {
    [workItem, sessions] = await Promise.all([
      apiFetch<WorkItem>(`/api/work-items/${params.workItemId}`),
      apiFetch<Session[]>(`/api/work-items/${params.workItemId}/sessions`),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load work item";
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (!workItem) {
    return <div className="text-gray-600">Loading work item...</div>;
  }

  const context = workItem.contextBundle;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-6">
        <div className="bg-white p-5 rounded-lg shadow border border-gray-200">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium uppercase tracking-wide text-gray-500">
                {workItem.type}
              </div>
              <h1 className="mt-1 text-2xl font-bold text-gray-900">
                {workItem.title}
              </h1>
            </div>
            <StatusSelect workItemId={workItem.id} current={workItem.status} />
          </div>

          <div className="mt-4 flex flex-wrap gap-4 text-sm text-gray-600">
            <div>
              Priority: <span className="font-medium">{workItem.priority}</span>
            </div>
            <div>
              Assignee:{" "}
              <span className="font-medium">
                {workItem.assignee?.name ?? "Unassigned"}
              </span>
            </div>
          </div>
        </div>

        {workItem.description ? (
          <section className="bg-white p-5 rounded-lg shadow border border-gray-200">
            <h2 className="text-md font-semibold text-gray-900">Description</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">
              {workItem.description}
            </p>
          </section>
        ) : null}

        {workItem.acceptanceCriteria ? (
          <section className="bg-white p-5 rounded-lg shadow border border-gray-200">
            <h2 className="text-md font-semibold text-gray-900">
              Acceptance Criteria
            </h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">
              {workItem.acceptanceCriteria}
            </p>
          </section>
        ) : null}

        {context ? (
          <section className="bg-white p-5 rounded-lg shadow border border-gray-200">
            <h2 className="text-md font-semibold text-gray-900">
              Context Bundle
              {context.stale ? (
                <span className="ml-2 rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700">
                  stale
                </span>
              ) : null}
            </h2>
            <div className="mt-3 space-y-2 text-sm text-gray-700">
              {context.summary ? (
                <p>
                  <span className="font-medium">Summary:</span> {context.summary}
                </p>
              ) : null}
              {context.goal ? (
                <p>
                  <span className="font-medium">Goal:</span> {context.goal}
                </p>
              ) : null}
              {context.acceptanceCriteria ? (
                <p>
                  <span className="font-medium">Acceptance:</span>{" "}
                  {context.acceptanceCriteria}
                </p>
              ) : null}
              {context.relatedFiles && context.relatedFiles.length > 0 ? (
                <div>
                  <span className="font-medium">Related files:</span>
                  <ul className="mt-1 list-inside list-disc text-gray-600">
                    {context.relatedFiles.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {context.recommendedCommands &&
              context.recommendedCommands.length > 0 ? (
                <div>
                  <span className="font-medium">Recommended commands:</span>
                  <ul className="mt-1 list-inside list-disc text-gray-600">
                    {context.recommendedCommands.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>

      <aside className="space-y-6">
        <StartSessionForm projectId={params.id} workItemId={workItem.id} />
        <WorkItemSessions sessions={sessions} />
      </aside>
    </div>
  );
}
