"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { WorkItemComment } from "@/lib/types";
import { apiFetch } from "@/lib/api";
import { MessageSquareIcon, PencilIcon, TrashIcon, XIcon } from "lucide-react";

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString();
}

export function WorkItemComments({
  workItemId,
  comments,
  currentUserId,
}: {
  workItemId: string;
  comments: WorkItemComment[];
  currentUserId?: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      await apiFetch(`/api/work-items/${workItemId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: body.trim() }),
      });
      setBody("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdate(commentId: string) {
    if (!editBody.trim()) return;
    setBusy(true);
    try {
      await apiFetch(`/api/work-items/${workItemId}/comments/${commentId}`, {
        method: "PATCH",
        body: JSON.stringify({ body: editBody.trim() }),
      });
      setEditingId(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(commentId: string) {
    setDeletingId(commentId);
    try {
      await apiFetch(`/api/work-items/${workItemId}/comments/${commentId}`, {
        method: "DELETE",
      });
      router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="bg-white p-5 rounded-lg shadow border border-gray-200">
      <h2 className="text-md font-semibold text-gray-900 flex items-center gap-2">
        <MessageSquareIcon className="size-4" />
        Comments ({comments.length})
      </h2>

      <form onSubmit={handleCreate} className="mt-4 space-y-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a comment to share context..."
          rows={3}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={busy || !body.trim()}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? "Posting..." : "Post Comment"}
          </button>
        </div>
      </form>

      <div className="mt-6 space-y-4">
        {comments.length === 0 ? (
          <p className="text-sm text-gray-500">
            No comments yet. Start the conversation by adding context or asking a
            question.
          </p>
        ) : (
          comments.map((comment) => (
            <div
              key={comment.id}
              className="border-t border-gray-100 pt-4 first:border-t-0 first:pt-0"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm">
                  <span className="font-medium text-gray-900">
                    {comment.author?.name ?? "Unknown"}
                  </span>
                  <span className="ml-2 text-xs text-gray-500">
                    {formatTime(comment.createdAt)}
                    {comment.updatedAt !== comment.createdAt ? (
                      <span className="ml-1 italic">
                        (edited {formatTime(comment.updatedAt)})
                      </span>
                    ) : null}
                  </span>
                </div>
                {comment.authorId === currentUserId ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        setEditingId(comment.id);
                        setEditBody(comment.body);
                      }}
                      disabled={busy}
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      title="Edit"
                    >
                      <PencilIcon className="size-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(comment.id)}
                      disabled={deletingId === comment.id}
                      className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                      title="Delete"
                    >
                      <TrashIcon className="size-3.5" />
                    </button>
                  </div>
                ) : null}
              </div>

              {editingId === comment.id ? (
                <div className="mt-2 space-y-2">
                  <textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleUpdate(comment.id)}
                      disabled={busy || !editBody.trim()}
                      className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      disabled={busy}
                      className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      <XIcon className="size-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">
                  {comment.body}
                </p>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
