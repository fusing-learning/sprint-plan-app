import type { AppData, ChangeSet, EntityTable } from '@/domain/types';

const TABLES: EntityTable[] = ['members', 'sections', 'projects', 'tickets', 'sprints'];

/** Pure: apply a change set to an in-memory snapshot of the workspace. */
export function applyChanges(data: AppData, changes: ChangeSet): AppData {
  const next: AppData = { ...data };
  for (const table of TABLES) {
    const deletes = changes.delete?.[table];
    const puts = changes.put?.[table] as { id: string }[] | undefined;
    if (!deletes?.length && !puts?.length) continue;
    const deleteSet = new Set(deletes ?? []);
    const putMap = new Map((puts ?? []).map((r) => [r.id, r]));
    const rows = (data[table] as { id: string }[])
      .filter((r) => !deleteSet.has(r.id))
      .map((r) => putMap.get(r.id) ?? r);
    const existing = new Set(rows.map((r) => r.id));
    for (const r of puts ?? []) if (!existing.has(r.id)) rows.push(r);
    (next as unknown as Record<EntityTable, unknown[]>)[table] = rows;
  }
  if (changes.put?.meta) next.meta = changes.put.meta;
  return next;
}
