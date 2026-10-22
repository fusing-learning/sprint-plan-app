import type { AppData, ChangeSet, EntityTable } from '@/domain/types';
import type { PlanningRepository } from './repository';

/** In-memory repository, useful for tests and as a reference implementation. */
export class MemoryPlanningRepository implements PlanningRepository {
  private data: AppData | null;

  constructor(initial: AppData | null = null) {
    this.data = initial ? structuredClone(initial) : null;
  }

  async load(): Promise<AppData | null> {
    return this.data ? structuredClone(this.data) : null;
  }

  async apply(changes: ChangeSet): Promise<void> {
    if (!this.data) throw new Error('Workspace not initialised');
    const next = structuredClone(this.data);
    const tables: EntityTable[] = ['members', 'sections', 'projects', 'tickets', 'sprints'];
    for (const table of tables) {
      const ids = new Set(changes.delete?.[table] ?? []);
      let rows = (next[table] as { id: string }[]).filter((r) => !ids.has(r.id));
      for (const row of (changes.put?.[table] as { id: string }[] | undefined) ?? []) {
        rows = rows.filter((r) => r.id !== row.id).concat(structuredClone(row));
      }
      (next[table] as { id: string }[]) = rows;
    }
    if (changes.put?.meta) next.meta = structuredClone(changes.put.meta);
    this.data = next;
  }

  async replaceAll(data: AppData): Promise<void> {
    this.data = structuredClone(data);
  }
}
