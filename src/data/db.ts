import Dexie, { type Table } from 'dexie';
import type { AppMeta, Member, Project, Section, Sprint, Ticket } from '@/domain/types';

export const DB_NAME = 'sprintflow';

/**
 * IndexedDB schema. To evolve the schema, add a new `this.version(n)` block
 * with an `.upgrade(tx => ...)` migration — never edit an existing version.
 */
export class SprintFlowDB extends Dexie {
  meta!: Table<AppMeta, string>;
  members!: Table<Member, string>;
  sections!: Table<Section, string>;
  projects!: Table<Project, string>;
  tickets!: Table<Ticket, string>;
  sprints!: Table<Sprint, string>;

  constructor(name: string = DB_NAME) {
    super(name);
    this.version(1).stores({
      meta: 'id',
      members: 'id, order',
      sections: 'id, order',
      projects: 'id, sectionId, order',
      tickets: 'id, projectId, sprintId, assigneeId, key',
      sprints: 'id, status, startDate',
    });
    // v2: tickets are planning-only — drop status, readiness, type, acceptance criteria and notes.
    this.version(2).stores({}).upgrade(async (tx) => {
      await tx
        .table('tickets')
        .toCollection()
        .modify((t: Record<string, unknown>) => {
          for (const key of ['status', 'readiness', 'type', 'acceptanceCriteria', 'notes']) delete t[key];
        });
      await tx
        .table('sprints')
        .toCollection()
        .modify((s: { snapshot?: { tickets?: Record<string, unknown>[] } | null }) => {
          for (const t of s.snapshot?.tickets ?? []) for (const key of ['status', 'readiness', 'type']) delete t[key];
        });
      await tx.table('meta').toCollection().modify((m: { schemaVersion: number }) => {
        m.schemaVersion = 2;
      });
    });
  }
}
