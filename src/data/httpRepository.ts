import type { AppData, ChangeSet } from '@/domain/types';
import { newId } from '@/lib/utils';
import { WriteConflictError, type ConnectionStatus, type PlanningRepository, type RemoteEvent, type WriteToken } from './repository';

/** Wire format shared with `server/app.ts`. */
export interface ServerChange {
  revision: number;
  clientId: string;
  kind: 'apply' | 'replace';
  changes?: ChangeSet;
  data?: AppData;
}

interface Token {
  /** Server revision this write was validated against; null = the client is out of sync. */
  base: number | null;
  epoch: number;
}

/** No heartbeat for this long means the connection is dead (e.g. the host went to sleep). */
const STALE_MS = 45_000;

/**
 * Talks to the SprintFlow server (`server/app.ts`), so everyone on the network
 * plans in one shared workspace.
 *
 * Every write carries the server revision it was validated against. The server
 * rejects it with 409 if anyone else wrote in between, so capacity rules are
 * never checked against stale data. The store then reloads and the user retries.
 */
export class HttpPlanningRepository implements PlanningRepository {
  readonly clientId = newId('client');
  /** Latest server revision reflected in the store's data. */
  private revision = 0;
  /** Revision the next write is based on: `revision` plus this client's writes in flight. */
  private expected = 0;
  /** Writes prepared in the current epoch that have not finished yet. */
  private inFlight = 0;
  /** Set after a failed write until the next `load()`, so writes based on stale data fail fast. */
  private outOfSync = false;
  /** Bumped on every failed write: writes queued before it are dropped, as the store's reload discards them. */
  private epoch = 0;

  constructor(
    private readonly baseUrl = '',
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  async load(): Promise<AppData | null> {
    const body = await this.request<{ revision: number; data: AppData | null }>('GET', '/api/workspace');
    this.revision = body.revision;
    if (this.inFlight === 0) {
      this.expected = body.revision;
      this.outOfSync = false;
    }
    return body.data;
  }

  prepareWrite(): WriteToken {
    const token: Token = { base: this.outOfSync ? null : this.expected++, epoch: this.epoch };
    this.inFlight++;
    return token;
  }

  apply(changes: ChangeSet, token?: WriteToken): Promise<void> {
    return this.write('POST', '/api/changes', { changes }, token);
  }

  replaceAll(data: AppData, token?: WriteToken): Promise<void> {
    return this.write('PUT', '/api/workspace', { data }, token);
  }

  private async write(method: string, path: string, payload: object, token: WriteToken = this.prepareWrite()) {
    const { base, epoch } = token as Token;
    if (epoch !== this.epoch) return;
    try {
      if (base === null) throw new Error('Not saved: SprintFlow is re-syncing with the server. Try again in a moment.');
      const body = await this.request<{ revision: number }>(method, path, { ...payload, clientId: this.clientId, baseRevision: base });
      this.revision = Math.max(this.revision, body.revision);
    } catch (e) {
      // Whether or not it landed, later writes were validated on top of it: resync before writing again.
      this.outOfSync = true;
      this.epoch++;
      this.inFlight = 0;
      throw e;
    } finally {
      if (epoch === this.epoch) {
        this.inFlight--;
        if (this.inFlight === 0) this.expected = this.revision;
      }
    }
  }

  private async request<T>(method: string, path: string, body?: object): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.baseUrl + path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error('Could not reach the SprintFlow server. Check that it is still running.');
    }
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (res.status === 409) throw new WriteConflictError();
    if (!res.ok) throw new Error(json.error ?? `Server error (${res.status}).`);
    return json;
  }

  // ---------------------------------------------------------------- live updates

  watch(onEvent: (event: RemoteEvent) => void, onStatus: (status: ConnectionStatus) => void): () => void {
    let stopped = false;
    let controller: AbortController | null = null;

    const handle = (type: string, data: string) => {
      if (type === 'ready') {
        onStatus('live');
        // Back after a failed write (e.g. the server was down): pick up the server's state.
        if (this.outOfSync) onEvent({ kind: 'resync' });
        return;
      }
      if (type === 'resync') return onEvent({ kind: 'resync' });
      if (type !== 'change') return;
      const change = JSON.parse(data) as ServerChange;
      if (change.revision <= this.revision) return;
      this.revision = change.revision;
      if (change.clientId === this.clientId) return;
      if (this.inFlight === 0 && !this.outOfSync) this.expected = change.revision;
      if (change.kind === 'replace' && change.data) onEvent({ kind: 'replace', data: change.data });
      else if (change.changes) onEvent({ kind: 'apply', changes: change.changes });
    };

    const run = async () => {
      let delay = 1000;
      while (!stopped) {
        onStatus('connecting');
        controller = new AbortController();
        const ctrl = controller;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const keepAlive = () => {
          clearTimeout(timer);
          timer = setTimeout(() => ctrl.abort(), STALE_MS);
        };
        try {
          keepAlive();
          const res = await this.fetchImpl(`${this.baseUrl}/api/events?since=${this.revision}`, {
            headers: { Accept: 'text/event-stream' },
            signal: ctrl.signal,
          });
          if (!res.ok || !res.body) throw new Error(`Event stream failed (${res.status})`);
          await readEventStream(res.body, (type, data) => {
            keepAlive();
            delay = 1000;
            handle(type, data);
          });
        } catch {
          // Reconnect below.
        } finally {
          clearTimeout(timer);
        }
        if (stopped) return;
        onStatus('offline');
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 15_000);
      }
    };
    void run();

    return () => {
      stopped = true;
      controller?.abort();
    };
  }
}

/** Minimal Server-Sent Events parser over a fetch body (comments count as heartbeats). */
async function readEventStream(body: ReadableStream<Uint8Array>, onMessage: (type: string, data: string) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let type = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) type = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      onMessage(data.length || type !== 'message' ? type : 'heartbeat', data.join('\n'));
    }
  }
}
