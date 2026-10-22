import type { AppData, ChangeSet } from '@/domain/types';

/**
 * Data-access abstraction. The UI and business logic only talk to this
 * interface, so the local IndexedDB implementation can be swapped for a
 * backend API (e.g. `HttpPlanningRepository`) without touching components.
 *
 * Contract:
 * - `load()` returns null when the workspace has never been initialised.
 * - `apply()` must be atomic: either every put/delete succeeds or none do.
 * - `replaceAll()` atomically replaces the whole workspace (used by import/reset).
 */
export interface PlanningRepository {
  load(): Promise<AppData | null>;
  apply(changes: ChangeSet): Promise<void>;
  replaceAll(data: AppData): Promise<void>;
}
