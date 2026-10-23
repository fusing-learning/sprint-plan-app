import type { AppData, ChangeSet } from '@/domain/types';

/** Opaque value from `prepareWrite()`, handed back to `apply()` / `replaceAll()`. */
export type WriteToken = unknown;

/** A change made by someone else, pushed by a shared repository. */
export type RemoteEvent =
  | { kind: 'apply'; changes: ChangeSet }
  | { kind: 'replace'; data: AppData }
  /** Events were missed (e.g. after a long disconnect): reload the whole workspace. */
  | { kind: 'resync' };

export type ConnectionStatus = 'connecting' | 'live' | 'offline';

/**
 * Data-access abstraction. The UI and business logic only talk to this
 * interface, so the local IndexedDB implementation can be swapped for a
 * backend API (`HttpPlanningRepository`) without touching components.
 *
 * Contract:
 * - `load()` returns null when the workspace has never been initialised.
 * - `apply()` must be atomic: either every put/delete succeeds or none do.
 * - `replaceAll()` atomically replaces the whole workspace (used by import/reset).
 *
 * Shared repositories also implement the optional members:
 * - `prepareWrite()` is called synchronously when the store accepts a change,
 *   so the write can be tied to the exact state it was validated against.
 * - `watch()` streams other people's changes and the connection status.
 */
export interface PlanningRepository {
  load(): Promise<AppData | null>;
  apply(changes: ChangeSet, token?: WriteToken): Promise<void>;
  replaceAll(data: AppData, token?: WriteToken): Promise<void>;
  prepareWrite?(): WriteToken;
  watch?(onEvent: (event: RemoteEvent) => void, onStatus: (status: ConnectionStatus) => void): () => void;
}

/** Thrown when a write was rejected because the workspace changed underneath it. */
export class WriteConflictError extends Error {
  constructor(message = 'Someone else changed the plan at the same moment.') {
    super(message);
    this.name = 'WriteConflictError';
  }
}
