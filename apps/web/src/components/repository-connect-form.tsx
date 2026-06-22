"use client";

import { FormEvent, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Repository } from "@/lib/types";

export function RepositoryConnectForm({
  projectId,
  onConnected,
}: {
  projectId: string;
  onConnected?: (repo: Repository) => void;
}) {
  const [provider, setProvider] = useState("github");
  const [url, setUrl] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const repo = await apiFetch<Repository>(
        `/api/projects/${projectId}/repositories`,
        {
          method: "POST",
          body: JSON.stringify({
            provider,
            url,
            accessToken: accessToken || undefined,
          }),
        },
      );
      setUrl("");
      setAccessToken("");
      onConnected?.(repo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect repository");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="github">GitHub</option>
          <option value="gitlab">GitLab</option>
        </select>
        <input
          type="url"
          required
          placeholder="https://github.com/owner/repo"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="sm:col-span-3 rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </div>
      <input
        type="password"
        placeholder="Access token (PAT) - optional if public"
        value={accessToken}
        onChange={(e) => setAccessToken(e.target.value)}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {loading ? "Connecting…" : "Connect repository"}
      </button>
    </form>
  );
}
