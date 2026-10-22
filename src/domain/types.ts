/**
 * Core domain model for SprintFlow.
 *
 * All IDs are stable, opaque strings generated locally. They never change once
 * created, so they can later be mapped 1:1 to records in a backend or in Jira.
 */

export const SCHEMA_VERSION = 2;
export const MAX_MEMBER_CAPACITY = 10;

export type ID = string;
/** ISO calendar date, `yyyy-MM-dd`. */
export type ISODate = string;
/** ISO timestamp. */
export type ISODateTime = string;

export interface Member {
  id: ID;
  name: string;
  role: string;
  /** Default per-sprint capacity in story points (0–10). */
  defaultCapacity: number;
  order: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type SectionColor = 'rose' | 'indigo' | 'amber' | 'violet' | 'teal' | 'slate' | 'emerald' | 'sky';

export interface Section {
  id: ID;
  name: string;
  description: string;
  color: SectionColor;
  order: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type ProjectLifecycle = 'active' | 'on_hold' | 'completed' | 'archived';

/** Optional references for a future Jira integration. Not shown in the UI yet. */
export interface ExternalProjectRef {
  jiraProjectId?: string;
  jiraProjectKey?: string;
  jiraEpicKey?: string;
}

export interface Project {
  id: ID;
  name: string;
  description: string;
  sectionId: ID;
  lifecycle: ProjectLifecycle;
  targetDate: ISODate | null;
  owner: string;
  order: number;
  external: ExternalProjectRef;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** Optional references for a future Jira integration. Not shown in the UI yet. */
export interface ExternalTicketRef {
  jiraProjectId?: string;
  jiraIssueKey?: string;
  jiraIssueId?: string;
}

/** A planned task. Progress is tracked elsewhere; SprintFlow only plans. */
export interface Ticket {
  id: ID;
  /** Human-friendly stable key, e.g. "SF-42". Never reused. */
  key: string;
  title: string;
  description: string;
  projectId: ID;
  assigneeId: ID | null;
  /** Story points. null = unestimated. Any number > 0 and ≤ 10. */
  points: number | null;
  /** null = backlog. A ticket can only ever belong to one sprint. */
  sprintId: ID | null;
  order: number;
  external: ExternalTicketRef;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type SprintStatus = 'planned' | 'active' | 'closed';

export type TicketOutcome = 'completed' | 'returned_to_backlog' | 'carried_forward';

export interface SnapshotTicket {
  ticketId: ID;
  key: string;
  title: string;
  projectId: ID;
  projectName: string;
  sectionName: string;
  assigneeId: ID | null;
  assigneeName: string | null;
  points: number | null;
  outcome: TicketOutcome;
  carriedToSprintId: ID | null;
  carriedToSprintName: string | null;
}

export interface SnapshotMember {
  memberId: ID;
  name: string;
  role: string;
  capacity: number;
  planned: number;
  completed: number;
}

/** Immutable record captured when a sprint closes. Never recalculated. */
export interface SprintSnapshot {
  closedAt: ISODateTime;
  sprintName: string;
  startDate: ISODate;
  endDate: ISODate;
  totalCapacity: number;
  committedPoints: number;
  completedPoints: number;
  incompletePoints: number;
  unestimatedCount: number;
  unassignedCount: number;
  members: SnapshotMember[];
  tickets: SnapshotTicket[];
}

export interface Sprint {
  id: ID;
  name: string;
  goal: string;
  startDate: ISODate;
  endDate: ISODate;
  status: SprintStatus;
  /** Per-member capacity override for this sprint (0–10). Missing = member default. */
  capacities: Record<ID, number>;
  snapshot: SprintSnapshot | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface AppMeta {
  id: 'app';
  schemaVersion: number;
  /** True once the workspace has been initialised. Nothing re-seeds afterwards. */
  initialized: boolean;
  nextTicketNumber: number;
  ticketKeyPrefix: string;
}

export interface AppData {
  meta: AppMeta;
  members: Member[];
  sections: Section[];
  projects: Project[];
  tickets: Ticket[];
  sprints: Sprint[];
}

export type EntityTable = 'members' | 'sections' | 'projects' | 'tickets' | 'sprints';

/** A transactional set of changes applied by the repository. */
export interface ChangeSet {
  put?: {
    members?: Member[];
    sections?: Section[];
    projects?: Project[];
    tickets?: Ticket[];
    sprints?: Sprint[];
    meta?: AppMeta;
  };
  delete?: Partial<Record<EntityTable, ID[]>>;
}

export const PROJECT_LIFECYCLE_LABEL: Record<ProjectLifecycle, string> = {
  active: 'Active',
  on_hold: 'On Hold',
  completed: 'Completed',
  archived: 'Archived',
};

export const SPRINT_STATUS_LABEL: Record<SprintStatus, string> = {
  planned: 'Planned',
  active: 'Active',
  closed: 'Closed',
};
