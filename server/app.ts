import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { applyChanges } from '../src/data/applyChanges';
import type { ServerChange } from '../src/data/httpRepository';
import { createBackup, parseBackup } from '../src/domain/backup';
import type { AppData, ChangeSet } from '../src/domain/types';

export interface ServerOptions {
  /** Folder holding `workspace.json` and the daily backups. */
  dataDir: string;
  /** Built frontend (`npm run build`). Omit to serve the API only (e.g. behind `vite dev`). */
  distDir?: string;
  /** How many days of daily backups to keep. */
  keepBackups?: number;
  log?: (message: string) => void;
}

interface Stored {
  revision: number;
  data: AppData | null;
}

const MAX_BODY = 25 * 1024 * 1024;
/** Recent changes kept in memory so a reconnecting client can catch up without a full reload. */
const REPLAY_SIZE = 500;
const HEARTBEAT_MS = 20_000;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The shared SprintFlow server: one workspace in a JSON file, a small REST API
 * and a Server-Sent Events stream that pushes every change to all open browsers.
 *
 * Writes must name the revision they were based on (optimistic concurrency).
 * Node handles requests one at a time between awaits, and the check and the
 * in-memory update happen synchronously, so two writes can never interleave.
 */
export async function createSprintflowServer(options: ServerOptions) {
  const log = options.log ?? ((m: string) => console.log(m));
  const file = path.join(options.dataDir, 'workspace.json');
  const backupDir = path.join(options.dataDir, 'backups');
  await fs.mkdir(backupDir, { recursive: true });

  let stored: Stored = { revision: 0, data: null };
  try {
    stored = JSON.parse(await fs.readFile(file, 'utf8')) as Stored;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Could not read ${file}: ${(e as Error).message}`);
  }

  // ------------------------------------------------------------ persistence

  let saving: Promise<void> = Promise.resolve();
  /** Writes are serialized; each one writes the latest state through a temp file + rename. */
  function persist(): Promise<void> {
    saving = saving.catch(() => undefined).then(async () => {
      await dailyBackup();
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(stored));
      await fs.rename(tmp, file);
    });
    return saving;
  }

  /** Before the first write of each day, keep a copy of the file as it was, and prune old copies. */
  async function dailyBackup() {
    const day = new Date().toISOString().slice(0, 10);
    const target = path.join(backupDir, `workspace-${day}.json`);
    try {
      await fs.access(target);
      return;
    } catch {
      /* not backed up yet today */
    }
    try {
      await fs.copyFile(file, target);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw e;
    }
    const keep = options.keepBackups ?? 30;
    const all = (await fs.readdir(backupDir)).filter((f) => /^workspace-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    for (const old of all.slice(0, Math.max(0, all.length - keep))) await fs.rm(path.join(backupDir, old), { force: true });
  }

  // ------------------------------------------------------------ live updates

  const clients = new Set<http.ServerResponse>();
  const replay: { revision: number; frame: string }[] = [];

  function broadcast(change: ServerChange) {
    const frame = `id: ${change.revision}\nevent: change\ndata: ${JSON.stringify(change)}\n\n`;
    replay.push({ revision: change.revision, frame });
    if (replay.length > REPLAY_SIZE) replay.shift();
    for (const res of clients) res.write(frame);
  }

  function openStream(req: http.IncomingMessage, res: http.ServerResponse, since: number) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    if (since < stored.revision) {
      const missed = replay.filter((e) => e.revision > since);
      // Only replay when the buffer covers the whole gap; otherwise the client reloads.
      if (missed.length && missed[0].revision === since + 1) for (const e of missed) res.write(e.frame);
      else res.write('event: resync\ndata: {}\n\n');
    }
    res.write(`event: ready\ndata: ${JSON.stringify({ revision: stored.revision })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
  }

  // ------------------------------------------------------------ writes

  function checkBase(body: { baseRevision?: unknown; clientId?: unknown }) {
    if (typeof body.clientId !== 'string') throw new HttpError(400, 'Missing clientId.');
    if (body.baseRevision !== stored.revision) {
      throw new HttpError(409, 'The workspace changed since this edit was made. Reload and try again.');
    }
  }

  async function commit(change: Omit<ServerChange, 'revision'>, data: AppData) {
    stored = { revision: stored.revision + 1, data };
    const revision = stored.revision;
    broadcast({ ...change, revision });
    await persist();
    return { revision };
  }

  function applyRequest(body: { changes?: ChangeSet; clientId: string }) {
    if (!stored.data) throw new HttpError(409, 'The workspace has not been set up yet.');
    const changes = body.changes;
    if (!changes || typeof changes !== 'object') throw new HttpError(400, 'Missing changes.');
    return commit({ clientId: body.clientId, kind: 'apply', changes }, applyChanges(stored.data, changes));
  }

  function replaceRequest(body: { data?: unknown; clientId: string }) {
    const parsed = parseBackup(createBackup(body.data as AppData));
    if (!parsed.ok) throw new HttpError(400, `Invalid workspace: ${parsed.errors.join(' ')}`);
    return commit({ clientId: body.clientId, kind: 'replace', data: parsed.data }, parsed.data);
  }

  // ------------------------------------------------------------ static files

  let indexHtml: string | null = null;
  async function serveStatic(urlPath: string, res: http.ServerResponse) {
    if (!options.distDir) throw new HttpError(404, 'Not found.');
    const root = path.resolve(options.distDir);
    let target: string;
    try {
      target = path.resolve(root, '.' + decodeURIComponent(urlPath));
    } catch {
      throw new HttpError(400, 'Bad path.');
    }
    if (target.startsWith(root + path.sep) && !target.endsWith('index.html')) {
      const stat = await fs.stat(target).catch(() => null);
      if (stat?.isFile()) {
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(target)] ?? 'application/octet-stream',
          // Vite fingerprints everything under assets/, so those never change.
          'Cache-Control': urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        });
        createReadStream(target).pipe(res);
        return;
      }
    }
    // SPA fallback. The meta tag tells the app to use this server instead of browser storage.
    indexHtml ??= (await fs.readFile(path.join(root, 'index.html'), 'utf8')).replace(
      '<head>',
      '<head>\n    <meta name="sprintflow-mode" content="shared" />',
    );
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
    res.end(indexHtml);
  }

  // ------------------------------------------------------------ routing

  async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY) throw new HttpError(413, 'Request too large.');
      chunks.push(chunk as Buffer);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new HttpError(400, 'Invalid JSON.');
    }
  }

  function sendJson(res: http.ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = `${req.method} ${url.pathname}`;
    try {
      if (route === 'GET /api/workspace') return sendJson(res, 200, stored);
      if (route === 'GET /api/health') return sendJson(res, 200, { ok: true, revision: stored.revision, clients: clients.size });
      if (route === 'GET /api/events') {
        const lastId = Number(req.headers['last-event-id'] ?? url.searchParams.get('since') ?? stored.revision);
        return openStream(req, res, Number.isFinite(lastId) ? lastId : stored.revision);
      }
      if (route === 'POST /api/changes' || route === 'PUT /api/workspace') {
        const body = await readJson(req);
        checkBase(body);
        const result = route === 'POST /api/changes' ? applyRequest(body as never) : replaceRequest(body as never);
        return sendJson(res, 200, await result);
      }
      if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'Not found.');
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
      await serveStatic(url.pathname, res);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) log(`SprintFlow server error on ${route}: ${(e as Error).stack ?? e}`);
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'Server error. See the server log.' : (e as Error).message });
      else res.end();
    }
  });

  /** Ends open event streams too, so `server.close()` doesn't wait on them. */
  async function close() {
    for (const res of clients) res.end();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await saving.catch(() => undefined);
  }

  return { server, close };
}
