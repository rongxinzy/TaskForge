import { apiFetch } from "@/lib/api";
import { PullRequest, Session, WorkItem, WorkItemComment } from "@/lib/types";
import { StartSessionForm } from "@/components/start-session-form";
import { WorkItemSessions } from "@/components/work-item-sessions";
import { WorkItemComments } from "@/components/work-item-comments";
import { WorkItemHeader } from "@/components/work-item-header";
import { GitPullRequestIcon } from "lucide-react";

interface CurrentUser {
  id: string;
  email: string;
  name: string;
}

export default async function WorkItemPage({
  params,
}: {
  params: { id: string; workItemId: string };
}) {
  let workItem: WorkItem | null = null;
  let sessions: Session[] = [];
  let comments: WorkItemComment[] = [];
  let currentUser: CurrentUser | null = null;
  let error: string | null = null;

  try {
    [workItem, sessions, comments] = await Promise.all([
      apiFetch<WorkItem>(`/api/work-items/${params.workItemId}`),
      apiFetch<Session[]>(`/api/work-items/${params.workItemId}/sessions`),
      apiFetch<WorkItemComment[]>(
        `/api/work-items/${params.workItemId}/comments`,
      ),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load work item";
  }

  try {
    currentUser = await apiFetch<CurrentUser>("/api/users/me");
  } catch {
    currentUser = null;
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
        <WorkItemHeader
          workItem={workItem}
          currentUserId={currentUser?.id}
        />

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

        {workItem.reproductionSteps ? (
          <section className="bg-white p-5 rounded-lg shadow border border-gray-200">
            <h2 className="text-md font-semibold text-gray-900">
              Reproduction Steps
            </h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">
              {workItem.reproductionSteps}
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

        <WorkItemComments
          workItemId={workItem.id}
          comments={comments}
          currentUserId={currentUser?.id}
        />
      </div>

      <aside className="space-y-6">
        <StartSessionForm projectId={params.id} workItemId={workItem.id} />
        <WorkItemSessions sessions={sessions} />
        <PullRequestList pullRequests={workItem.pullRequests ?? []} />
      </aside>
    </div>
  );
}

function PullRequestList({ pullRequests }: { pullRequests: PullRequest[] }) {
  return (
    <section className="bg-white p-5 rounded-lg shadow border border-gray-200">
      <h2 className="text-md font-semibold text-gray-900 flex items-center gap-2">
        <GitPullRequestIcon className="size-4" />
        Pull Requests
      </h2>
      {pullRequests.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">No pull requests linked yet.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {pullRequests.map((pr) => (
            <li key={pr.id} className="text-sm">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 capitalize">
                  {pr.state}
                </span>
                {pr.url ? (
                  <a
                    href={pr.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-blue-600 hover:underline truncate"
                    title={pr.title ?? pr.headBranch}
                  >
                    {pr.title ?? pr.headBranch}
                  </a>
                ) : (
                  <span className="font-medium text-gray-900 truncate">
                    {pr.title ?? pr.headBranch}
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                {pr.provider} · {pr.headBranch} → {pr.baseBranch}
                {pr.number ? ` · #${pr.number}` : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
