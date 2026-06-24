"use client";

import { useState } from "react";
import { WorkItem } from "@/lib/types";
import { StatusSelect } from "@/components/status-select";
import { EditWorkItemForm } from "@/components/edit-work-item-form";
import { PencilIcon } from "lucide-react";

export function WorkItemHeader({
  workItem,
  currentUserId,
}: {
  workItem: WorkItem;
  currentUserId?: string;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="space-y-4">
      <div className="bg-white p-5 rounded-lg shadow border border-gray-200">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium uppercase tracking-wide text-gray-500">
              {workItem.type.replace("_", " ")}
            </div>
            <h1 className="mt-1 text-2xl font-bold text-gray-900">
              {workItem.title}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <StatusSelect workItemId={workItem.id} current={workItem.status} />
            {currentUserId ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <PencilIcon className="size-4" />
                Edit
              </button>
            ) : null}
          </div>
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

      {editing ? (
        <EditWorkItemForm
          workItem={workItem}
          onCancel={() => setEditing(false)}
        />
      ) : null}
    </div>
  );
}
