"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Runner } from "@/lib/types";

interface RunnerRegistration {
  runner_id: string;
  token: string;
  agents: { id: string; name: string; adapter?: string | null; status: string }[];
}

export function RunnerSettings({ projectId }: { projectId: string }) {
  const [runners, setRunners] = useState<Runner[]>([]);
  const [name, setName] = useState("");
  const [registration, setRegistration] = useState<RunnerRegistration | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadRunners() {
    try {
      const data = await apiFetch<Runner[]>(`/api/runner/projects/${projectId}`);
      setRunners(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load runners");
    }
  }

  useEffect(() => {
    loadRunners();
  }, [projectId]);

  async function register(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setRegistration(null);
    try {
      const result = await apiFetch<RunnerRegistration>("/api/runner/register", {
        method: "POST",
        body: JSON.stringify({ name, projectId, adapter: "local" }),
      });
      setRegistration(result);
      setName("");
      loadRunners();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register runner");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-900">Registered runners</h3>
        {runners.length === 0 ? (
          <p className="text-sm text-gray-500">No runners registered for this project yet.</p>
        ) : (
          <ul className="divide-y divide-gray-200 rounded-md border border-gray-200">
            {runners.map((runner) => (
              <li key={runner.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{runner.name}</p>
                    <p className="text-xs text-gray-500">{runner.id}</p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      runner.status === "online"
                        ? "bg-green-100 text-green-700"
                        : runner.status === "busy"
                        ? "bg-yellow-100 text-yellow-700"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {runner.status}
                  </span>
                </div>
                {runner.agents.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {runner.agents.map((agent) => (
                      <span
                        key={agent.id}
                        className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
                        title={`adapter: ${agent.adapter ?? "default"}`}
                      >
                        {agent.name} · {agent.status}
                      </span>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={register} className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Register a new local runner</h3>
        <p className="text-xs text-gray-500">
          Give your local runner a name. After registration you will get a token to use with the CLI.
        </p>
        <div className="flex gap-3">
          <input
            type="text"
            required
            placeholder="Runner name, e.g. macbook-pro"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? "Registering…" : "Register"}
          </button>
        </div>
      </form>

      {registration ? (
        <div className="rounded-md border border-indigo-200 bg-indigo-50 p-4">
          <p className="text-sm font-medium text-indigo-900">Runner registered</p>
          <p className="mt-1 text-xs text-indigo-700">
            Runner ID: <code className="font-mono">{registration.runner_id}</code>
          </p>
          <p className="mt-2 text-xs text-gray-700">
            Copy the token below and run in your terminal:
          </p>
          <pre className="mt-1 overflow-x-auto rounded-md bg-gray-900 p-3 text-xs text-gray-100">
{`taskforge-runner login --token ${registration.token}
taskforge-runner start`}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
