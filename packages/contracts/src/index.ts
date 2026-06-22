import { z } from "zod";

export const WorkItemType = z.enum(["bug", "feature", "tech_debt", "finding"]);
export type WorkItemType = z.infer<typeof WorkItemType>;

export const WorkItemStatus = z.enum([
  "backlog",
  "ready",
  "in_progress",
  "blocked",
  "needs_review",
  "done",
  "cancelled",
]);
export type WorkItemStatus = z.infer<typeof WorkItemStatus>;

export const Priority = z.enum(["low", "medium", "high", "critical"]);
export type Priority = z.infer<typeof Priority>;

export const SessionStatus = z.enum([
  "created",
  "context_compiling",
  "queued",
  "dispatching",
  "running",
  "awaiting_input",
  "awaiting_approval",
  "verifying",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const RunnerStatus = z.enum(["offline", "online", "busy", "error", "disabled"]);
export type RunnerStatus = z.infer<typeof RunnerStatus>;

export const FindingStatus = z.enum([
  "open",
  "converted",
  "linked",
  "ignored",
  "false_positive",
  "snoozed",
]);
export type FindingStatus = z.infer<typeof FindingStatus>;

export const Mode = z.enum(["goal", "plan", "investigate"]);
export type Mode = z.infer<typeof Mode>;

export const EventType = z.enum([
  "session.created",
  "context.compiled",
  "runner.dispatched",
  "runner.accepted",
  "runner.rejected",
  "session.started",
  "agent.input.created",
  "agent.output.delta",
  "agent.output.completed",
  "agent.thinking",
  "agent.message",
  "tool.call",
  "tool.call_update",
  "usage.update",
  "acp.available_commands",
  "acp.update",
  "command.started",
  "command.output",
  "command.finished",
  "file.changed",
  "diff.generated",
  "verification.started",
  "verification.passed",
  "verification.failed",
  "artifact.uploaded",
  "session.awaiting_input",
  "approval.requested",
  "human.input",
  "session.completed",
  "session.failed",
  "session.cancelled",
  "session.interrupted",
]);
export type EventType = z.infer<typeof EventType>;

export const CreateProjectInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  teamId: z.string().cuid2().optional(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInput>;

export const CreateWorkItemInput = z.object({
  projectId: z.string().cuid2(),
  type: WorkItemType,
  priority: Priority,
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  acceptanceCriteria: z.string().max(5000).optional(),
  reproductionSteps: z.string().max(5000).optional(),
  repositoryId: z.string().cuid2().optional(),
});
export type CreateWorkItemInput = z.infer<typeof CreateWorkItemInput>;

export const UpdateWorkItemStatusInput = z.object({
  status: WorkItemStatus,
  reason: z.string().max(1000).optional(),
});
export type UpdateWorkItemStatusInput = z.infer<typeof UpdateWorkItemStatusInput>;

export const RunnerAgentInput = z.object({
  name: z.string().min(1).max(100),
  adapter: z.string().max(100).optional(),
  status: z.enum(["online", "offline"]).optional(),
});
export type RunnerAgentInput = z.infer<typeof RunnerAgentInput>;

export const CreateSessionInput = z.object({
  workItemId: z.string().cuid2(),
  mode: Mode,
  runnerId: z.string().cuid2().optional(),
  agentName: z.string().max(100).optional(),
  instruction: z.string().max(5000).optional(),
});
export type CreateSessionInput = z.infer<typeof CreateSessionInput>;

export const HumanInputEventInput = z.object({
  body: z.string().min(1).max(5000),
});
export type HumanInputEventInput = z.infer<typeof HumanInputEventInput>;

export const RegisterInput = z.object({
  email: z.string().email().min(1).max(200),
  password: z.string().min(8).max(100),
  name: z.string().min(1).max(100),
});
export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({
  email: z.string().email().min(1).max(200),
  password: z.string().min(1).max(100),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const RunnerRegisterInput = z.object({
  name: z.string().min(1).max(200),
  projectId: z.string().cuid2().optional(),
  adapter: z.string().max(100).optional(),
  capabilities: z.record(z.unknown()).or(z.array(z.string())).optional(),
  agents: z.array(RunnerAgentInput).optional(),
  scope: z.enum(["personal", "shared", "public"]).optional(),
});
export type RunnerRegisterInput = z.infer<typeof RunnerRegisterInput>;

export const CreateRunnerRegistrationTokenInput = z.object({
  projectId: z.string().cuid2(),
});
export type CreateRunnerRegistrationTokenInput = z.infer<
  typeof CreateRunnerRegistrationTokenInput
>;

export const RunnerUpInput = z.object({
  token: z.string().min(1),
  name: z.string().min(1).max(200),
  adapter: z.string().max(100).optional(),
});
export type RunnerUpInput = z.infer<typeof RunnerUpInput>;

export const SetRunnerVisibilityInput = z.object({
  projectId: z.string().cuid2(),
  visible: z.boolean(),
});
export type SetRunnerVisibilityInput = z.infer<typeof SetRunnerVisibilityInput>;

export const RunnerHeartbeatInput = z.object({
  status: RunnerStatus,
  version: z.string().max(50).optional(),
  capabilities: z.record(z.unknown()).or(z.array(z.string())).optional(),
  bindings: z
    .array(
      z.object({
        repositoryId: z.string(),
        status: z.enum(["bound", "unbound", "error"]),
      }),
    )
    .optional(),
  agents: z.array(RunnerAgentInput).optional(),
});
export type RunnerHeartbeatInput = z.infer<typeof RunnerHeartbeatInput>;

export const AppendSessionEventInput = z.object({
  seq: z.number().int().min(1),
  type: EventType,
  payload: z.record(z.unknown()),
  rawAcpJson: z.record(z.unknown()).optional(),
});
export type AppendSessionEventInput = z.infer<typeof AppendSessionEventInput>;

export const UploadArtifactInput = z.object({
  type: z.string().min(1).max(100),
  sha256: z.string().length(64).optional(),
  sizeBytes: z.number().int().min(0).optional(),
  redactionStatus: z.enum(["pending", "applied", "rejected", "clean"]).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type UploadArtifactInput = z.infer<typeof UploadArtifactInput>;

export const RepositoryProviderInput = z.object({
  provider: z.enum(["github", "gitlab"]),
  url: z.string().url().max(1000),
  accessToken: z.string().max(2000).optional(),
  externalId: z.string().max(200).optional(),
  defaultBranch: z.string().max(200).optional(),
});
export type RepositoryProviderInput = z.infer<typeof RepositoryProviderInput>;

export const ProjectRole = z.enum([
  "owner",
  "maintainer",
  "contributor",
  "viewer",
]);
export type ProjectRole = z.infer<typeof ProjectRole>;

export const TeamRole = z.enum(["owner", "admin", "member"]);
export type TeamRole = z.infer<typeof TeamRole>;

export const CreateUserInput = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(200),
});
export type CreateUserInput = z.infer<typeof CreateUserInput>;

export const CreateTeamInput = z.object({
  name: z.string().min(1).max(200),
});
export type CreateTeamInput = z.infer<typeof CreateTeamInput>;

export const AddTeamMemberInput = z.object({
  userId: z.string().cuid2(),
  role: TeamRole,
});
export type AddTeamMemberInput = z.infer<typeof AddTeamMemberInput>;

export const UpdateTeamMemberRoleInput = z.object({
  role: TeamRole,
});
export type UpdateTeamMemberRoleInput = z.infer<typeof UpdateTeamMemberRoleInput>;

export const AddProjectMemberInput = z.object({
  userId: z.string().cuid2(),
  role: ProjectRole,
});
export type AddProjectMemberInput = z.infer<typeof AddProjectMemberInput>;

export const UpdateProjectMemberRoleInput = z.object({
  role: ProjectRole,
});
export type UpdateProjectMemberRoleInput = z.infer<typeof UpdateProjectMemberRoleInput>;
