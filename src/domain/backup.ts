import { z } from 'zod';
import { SCHEMA_VERSION, type AppData } from './types';

/**
 * JSON backup format:
 * { app: "sprintflow", schemaVersion, exportedAt, data: AppData }
 *
 * When SCHEMA_VERSION changes, add a migration step to `MIGRATIONS` that turns
 * version n data into version n+1 data. Imports are migrated forward before validation.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected yyyy-MM-dd date');
const timestamp = z.string().min(1);
const id = z.string().min(1);

const memberSchema = z.object({
  id,
  name: z.string(),
  role: z.string().default(''),
  defaultCapacity: z.number().min(0).max(10),
  order: z.number(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const sectionSchema = z.object({
  id,
  name: z.string(),
  description: z.string().default(''),
  color: z.enum(['rose', 'indigo', 'amber', 'violet', 'teal', 'slate', 'emerald', 'sky']),
  order: z.number(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const projectSchema = z.object({
  id,
  name: z.string(),
  description: z.string().default(''),
  sectionId: id,
  lifecycle: z.enum(['active', 'on_hold', 'completed', 'archived']),
  targetDate: isoDate.nullable(),
  owner: z.string().default(''),
  order: z.number(),
  external: z
    .object({ jiraProjectId: z.string().optional(), jiraProjectKey: z.string().optional(), jiraEpicKey: z.string().optional() })
    .default({}),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const ticketSchema = z.object({
  id,
  key: z.string().min(1),
  title: z.string(),
  description: z.string().default(''),
  projectId: id,
  assigneeId: id.nullable(),
  points: z.number().gt(0, 'Story points must be greater than 0').max(10).nullable(),
  sprintId: id.nullable(),
  order: z.number(),
  external: z
    .object({ jiraProjectId: z.string().optional(), jiraIssueKey: z.string().optional(), jiraIssueId: z.string().optional() })
    .default({}),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const snapshotSchema = z.object({
  closedAt: timestamp,
  sprintName: z.string(),
  startDate: isoDate,
  endDate: isoDate,
  totalCapacity: z.number(),
  committedPoints: z.number(),
  completedPoints: z.number(),
  incompletePoints: z.number(),
  unestimatedCount: z.number(),
  unassignedCount: z.number(),
  members: z.array(
    z.object({
      memberId: id,
      name: z.string(),
      role: z.string(),
      capacity: z.number(),
      planned: z.number(),
      completed: z.number(),
    }),
  ),
  tickets: z.array(
    z.object({
      ticketId: id,
      key: z.string(),
      title: z.string(),
      projectId: id,
      projectName: z.string(),
      sectionName: z.string(),
      assigneeId: id.nullable(),
      assigneeName: z.string().nullable(),
      points: z.number().nullable(),
      outcome: z.enum(['completed', 'returned_to_backlog', 'carried_forward']),
      carriedToSprintId: id.nullable(),
      carriedToSprintName: z.string().nullable(),
    }),
  ),
});

const sprintSchema = z.object({
  id,
  name: z.string(),
  goal: z.string().default(''),
  startDate: isoDate,
  endDate: isoDate,
  status: z.enum(['planned', 'active', 'closed']),
  capacities: z.record(z.number().min(0).max(10)),
  snapshot: snapshotSchema.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const metaSchema = z.object({
  id: z.literal('app'),
  schemaVersion: z.number(),
  initialized: z.boolean(),
  nextTicketNumber: z.number().int().min(1),
  ticketKeyPrefix: z.string().min(1).default('SF'),
});

const dataSchema = z.object({
  meta: metaSchema,
  members: z.array(memberSchema),
  sections: z.array(sectionSchema),
  projects: z.array(projectSchema),
  tickets: z.array(ticketSchema),
  sprints: z.array(sprintSchema),
});

const backupSchema = z.object({
  app: z.literal('sprintflow'),
  schemaVersion: z.number().int().min(1),
  exportedAt: z.string(),
  data: z.unknown(),
});

export interface BackupFile {
  app: 'sprintflow';
  schemaVersion: number;
  exportedAt: string;
  data: AppData;
}

type Migration = (data: unknown) => unknown;
/**
 * MIGRATIONS[n] upgrades data from schema version n to n + 1.
 * v1 → v2 removed ticket status, readiness, type, acceptance criteria and notes.
 * Unknown keys are stripped by the zod schemas, so that step needs no code.
 */
const MIGRATIONS: Record<number, Migration> = {
  1: (data) => data,
};

export function createBackup(data: AppData, now: Date = new Date()): BackupFile {
  return { app: 'sprintflow', schemaVersion: SCHEMA_VERSION, exportedAt: now.toISOString(), data: structuredClone(data) };
}

export type ParseResult = { ok: true; data: AppData; exportedAt: string } | { ok: false; errors: string[] };

export function parseBackup(raw: string | unknown): ParseResult {
  let json: unknown = raw;
  if (typeof raw === 'string') {
    try {
      json = JSON.parse(raw);
    } catch {
      return { ok: false, errors: ['The file is not valid JSON.'] };
    }
  }
  const envelope = backupSchema.safeParse(json);
  if (!envelope.success) {
    return { ok: false, errors: ['This does not look like a SprintFlow backup (missing "app": "sprintflow" header).'] };
  }
  if (envelope.data.schemaVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [`This backup uses schema v${envelope.data.schemaVersion}, newer than this app supports (v${SCHEMA_VERSION}).`],
    };
  }
  let payload = envelope.data.data;
  for (let v = envelope.data.schemaVersion; v < SCHEMA_VERSION; v++) {
    const migrate = MIGRATIONS[v];
    if (!migrate) return { ok: false, errors: [`No migration available from schema v${v}.`] };
    payload = migrate(payload);
  }
  const parsed = dataSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, 8).map((i) => `${i.path.join('.') || 'data'}: ${i.message}`),
    };
  }
  const data = parsed.data as AppData;
  const integrity = checkIntegrity(data);
  if (integrity.length) return { ok: false, errors: integrity };
  data.meta = { ...data.meta, schemaVersion: SCHEMA_VERSION, initialized: true };
  return { ok: true, data, exportedAt: envelope.data.exportedAt };
}

/** Referential checks that a schema alone cannot express. */
export function checkIntegrity(data: AppData): string[] {
  const errors: string[] = [];
  const sectionIds = new Set(data.sections.map((s) => s.id));
  const projectIds = new Set(data.projects.map((p) => p.id));
  const memberIds = new Set(data.members.map((m) => m.id));
  const sprintIds = new Set(data.sprints.map((s) => s.id));
  for (const p of data.projects) if (!sectionIds.has(p.sectionId)) errors.push(`Project "${p.name}" references a missing section.`);
  for (const t of data.tickets) {
    if (!projectIds.has(t.projectId)) errors.push(`Ticket ${t.key} references a missing project.`);
    if (t.assigneeId && !memberIds.has(t.assigneeId)) errors.push(`Ticket ${t.key} references a missing assignee.`);
    if (t.sprintId && !sprintIds.has(t.sprintId)) errors.push(`Ticket ${t.key} references a missing sprint.`);
  }
  if (data.sprints.filter((s) => s.status === 'active').length > 1) errors.push('More than one sprint is marked Active.');
  const ids = new Set<string>();
  for (const t of data.tickets) {
    if (ids.has(t.id)) errors.push(`Duplicate ticket id ${t.id}.`);
    ids.add(t.id);
  }
  return errors.slice(0, 8);
}
