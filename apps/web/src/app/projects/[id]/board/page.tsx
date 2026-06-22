import Link from "next/link";
import { apiFetch } from "@/lib/api";
import {
  ProjectBoard,
  Repository,
  WorkItem,
  WorkItemStatus,
} from "@/lib/types";
import { WorkItemCard } from "@/components/work-item-card";
import { CreateWorkItemForm } from "@/components/create-work-item-form";
import { RepositoryList } from "@/components/repository-list";

const columns: WorkItemStatus[] = [
  "backlog",
  "ready",
  "in_progress",
  "blocked",
  "needs_review",
  "done",
];

function columnLabel(status: WorkItemStatus) {
  return status.replace(/_/g, " ");
}

export default async function BoardPage({
  params,
}: {
  params: { id: string };
}) {
  let board: ProjectBoard | null = null;
  let repositories: Repository[] = [];
  let error: string | null = null;

  try {
    [board, repositories] = await Promise.all([
      apiFetch<ProjectBoard>(`/api/projects/${params.id}/board`),
      apiFetch<Repository[]>(`/api/projects/${params.id}/repositories`).catch(
        () => [],
      ),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load board";
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (!board) {
    return <div className="text-gray-600">Loading board...</div>;
  }

  const itemsByStatus: Record<WorkItemStatus, WorkItem[]> = {
    backlog: [],
    ready: [],
    in_progress: [],
    blocked: [],
    needs_review: [],
    done: [],
    cancelled: [],
  };
  for (const item of board.items) {
    itemsByStatus[item.status].push(item);
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {board.project.name} Board
          </h1>
          {board.project.description ? (
            <p className="mt-1 text-sm text-gray-600">
              {board.project.description}
            </p>
          ) : null}
          <div className="mt-2">
            <RepositoryList projectId={params.id} initialRepos={repositories} />
          </div>
        </div>
        <Link
          href={`/projects/${params.id}/settings`}
          className="shrink-0 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Settings
        </Link>
      </div>

      <CreateWorkItemForm projectId={params.id} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {columns.map((status) => (
          <div
            key={status}
            className="rounded-lg border border-gray-200 bg-gray-100 p-3"
          >
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-700">
              {columnLabel(status)}
              <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600">
                {itemsByStatus[status].length}
              </span>
            </h2>
            <div className="space-y-3">
              {itemsByStatus[status].map((item) => (
                <WorkItemCard key={item.id} workItem={item} projectId={params.id} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
