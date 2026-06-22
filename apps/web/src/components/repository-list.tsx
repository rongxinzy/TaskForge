"use client";

import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { Repository } from "@/lib/types";
import { useEffect, useState } from "react";

function providerLabel(repo: Repository) {
  const parts = repo.url.replace(/\.git$/, "").split("/");
  const name = parts[parts.length - 1] ?? repo.url;
  return `${repo.provider}/${name}`;
}

export function RepositoryList({
  projectId,
  initialRepos,
}: {
  projectId: string;
  initialRepos?: Repository[];
}) {
  const [repos, setRepos] = useState<Repository[]>(initialRepos ?? []);
  const [loading, setLoading] = useState(!initialRepos);

  useEffect(() => {
    if (initialRepos) return;
    apiFetch<Repository[]>(`/api/projects/${projectId}/repositories`)
      .then(setRepos)
      .catch(() => setRepos([]))
      .finally(() => setLoading(false));
  }, [projectId, initialRepos]);

  if (loading) {
    return <span className="text-xs text-gray-400">loading repos…</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {repos.length === 0 ? (
        <span className="text-xs text-gray-400">no repositories</span>
      ) : (
        repos.map((repo) => (
          <a
            key={repo.id}
            href={repo.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-600 hover:border-gray-300 hover:text-gray-900"
            title={repo.url}
          >
            <span className="uppercase text-[10px] text-gray-400">
              {repo.provider}
            </span>
            <span>{providerLabel(repo)}</span>
            {repo.defaultBranch ? (
              <span className="text-gray-400">· {repo.defaultBranch}</span>
            ) : null}
          </a>
        ))
      )}
      <Link
        href={`/projects/${projectId}/settings`}
        className="rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:border-gray-400 hover:text-gray-700"
      >
        + connect repo
      </Link>
    </div>
  );
}
