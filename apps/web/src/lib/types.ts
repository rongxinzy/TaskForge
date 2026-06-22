import {
  WorkItemStatus,
  WorkItemType,
  Priority,
  SessionStatus,
  Mode,
  EventType,
} from "@taskforge/contracts";

export {
  WorkItemStatus,
  WorkItemType,
  Priority,
  SessionStatus,
  Mode,
  EventType,
};

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Assignee {
  id: string;
  name: string;
}

export interface ActiveSession {
  id: string;
  status: SessionStatus;
}

export interface ContextBundle {
  id: string;
  version: number;
  summary?: string;
  goal?: string;
  acceptanceCriteria?: string;
  relatedFiles?: string[];
  recommendedCommands?: string[];
  stale?: boolean;
  createdAt?: string;
}

export interface WorkItem {
  id: string;
  projectId: string;
  type: WorkItemType;
  title: string;
  status: WorkItemStatus;
  priority: Priority;
  description?: string;
  acceptanceCriteria?: string;
  reproductionSteps?: string;
  assignee?: Assignee | null;
  activeSession?: ActiveSession | null;
  contextBundle?: ContextBundle | null;
}

export interface ProjectBoard {
  project: Project;
  items: WorkItem[];
}

export interface Repository {
  id: string;
  projectId: string;
  provider: string;
  url: string;
  defaultBranch?: string | null;
  externalId?: string | null;
  syncStatus: string;
  lastSyncAt?: string | null;
  syncError?: string | null;
}

export interface RunnerAgent {
  id: string;
  name: string;
  adapter?: string | null;
  status: string;
}

export interface Runner {
  id: string;
  name: string;
  status: string;
  agents: RunnerAgent[];
  lastHeartbeatAt?: string | null;
}

export interface Session {
  id: string;
  workItemId: string;
  status: SessionStatus;
  mode: Mode;
  runnerId?: string;
  runnerName?: string;
  acpAgentInfoJson?: {
    agentName?: string | null;
    runnerName?: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionEvent {
  seq: number;
  type: EventType;
  createdAt: string;
  payload: Record<string, unknown>;
}
