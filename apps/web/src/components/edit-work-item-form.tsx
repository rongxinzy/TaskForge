"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  WorkItemType,
  Priority,
  type UpdateWorkItemInput,
} from "@taskforge/contracts";
import { WorkItem } from "@/lib/types";
import { apiFetch } from "@/lib/api";

const types: WorkItemType[] = ["feature", "bug", "tech_debt", "finding"];
const priorities: Priority[] = ["low", "medium", "high", "critical"];

export function EditWorkItemForm({
  workItem,
  onCancel,
}: {
  workItem: WorkItem;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(workItem.title);
  const [type, setType] = useState<WorkItemType>(workItem.type);
  const [priority, setPriority] = useState<Priority>(workItem.priority);
  const [description, setDescription] = useState(workItem.description ?? "");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(
    workItem.acceptanceCriteria ?? "",
  );
  const [reproductionSteps, setReproductionSteps] = useState(
    workItem.reproductionSteps ?? "",
  );
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      const payload: UpdateWorkItemInput = {
        title: title.trim(),
        type,
        priority,
        description: description.trim() || undefined,
        acceptanceCriteria: acceptanceCriteria.trim() || undefined,
        reproductionSteps: reproductionSteps.trim() || undefined,
      };
      await apiFetch(`/api/work-items/${workItem.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      router.refresh();
      onCancel();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white p-5 rounded-lg shadow border border-gray-200 space-y-4"
    >
      <h3 className="text-md font-semibold text-gray-900">Edit Work Item</h3>
      <div>
        <label htmlFor="edit-title" className="block text-sm font-medium text-gray-700">
          Title
        </label>
        <input
          id="edit-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="edit-type" className="block text-sm font-medium text-gray-700">
            Type
          </label>
          <select
            id="edit-type"
            value={type}
            onChange={(e) => setType(e.target.value as WorkItemType)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {types.map((t) => (
              <option key={t} value={t}>
                {t.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="edit-priority" className="block text-sm font-medium text-gray-700">
            Priority
          </label>
          <select
            id="edit-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {priorities.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label
          htmlFor="edit-description"
          className="block text-sm font-medium text-gray-700"
        >
          Description
        </label>
        <textarea
          id="edit-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
      <div>
        <label
          htmlFor="edit-acceptance"
          className="block text-sm font-medium text-gray-700"
        >
          Acceptance Criteria
        </label>
        <textarea
          id="edit-acceptance"
          value={acceptanceCriteria}
          onChange={(e) => setAcceptanceCriteria(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
      <div>
        <label
          htmlFor="edit-repro"
          className="block text-sm font-medium text-gray-700"
        >
          Reproduction Steps
        </label>
        <textarea
          id="edit-repro"
          value={reproductionSteps}
          onChange={(e) => setReproductionSteps(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? "Saving..." : "Save Changes"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
