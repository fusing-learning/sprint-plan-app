import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpPlanningRepository } from '@/data/httpRepository';
import { WriteConflictError } from '@/data/repository';
import { summarizeSprintCapacity } from '@/domain/capacity';
import { PlanningStore } from '@/state/planningStore';
import { createSprintflowServer } from './app';

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

async function startServer(dataDir?: string) {
  const dir = dataDir ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'sprintflow-')));
  const app = await createSprintflowServer({ dataDir: dir, log: () => undefined });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await app.close();
  };
  cleanup.push(close);
  return { url, dir, close };
}

async function connect(url: string) {
  const errors: unknown[] = [];
  const store = new PlanningStore(new HttpPlanningRepository(url), () => new Date('2026-10-22T09:00:00Z'), (e) => errors.push(e));
  await store.init();
  cleanup.push(() => store.dispose());
  await until(() => store.getState().connection === 'live');
  return { store, errors };
}

async function until(check: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('shared workspace server', () => {
  it('first browser sets up the workspace; the next one opens the same one', async () => {
    const { url } = await startServer();
    const a = await connect(url);
    const b = await connect(url);
    expect(b.store.data.members).toHaveLength(4);
    expect(b.store.data.sprints.map((s) => s.id)).toEqual(a.store.data.sprints.map((s) => s.id));
  });

  it('pushes changes to everyone live', async () => {
    const { url } = await startServer();
    const a = await connect(url);
    const b = await connect(url);
    const project = a.store.createProject({ name: 'Checkout', sectionId: a.store.data.sections[0].id });
    if (!project.ok) throw new Error(project.error);
    await until(() => b.store.data.projects.some((p) => p.id === project.value.id));

    const ticket = b.store.createTicket({ projectId: project.value.id, title: 'Pay with card' });
    await until(() => a.store.data.tickets.length === 1);
    expect(a.store.data.tickets[0].key).toBe(ticket.ok && ticket.value.key);

    a.store.clearWorkspace();
    await until(() => b.store.data.projects.length === 0);
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
  });

  it('rejects simultaneous edits that were checked against stale data, so capacity is never exceeded', async () => {
    const { url } = await startServer();
    const a = await connect(url);
    const b = await connect(url);
    const project = a.store.createProject({ name: 'Checkout', sectionId: a.store.data.sections[0].id });
    if (!project.ok) throw new Error(project.error);
    await until(() => b.store.data.projects.length === 1);
    const sprint = a.store.activeSprint!;
    const engineer = a.store.data.members.find((m) => m.name === 'Engineer A')!;

    // Each would fit on its own (8 + 8 > 10). Both are made before either hears about the other.
    const ra = a.store.createTicket({ projectId: project.value.id, title: 'A', assigneeId: engineer.id, points: 8, sprintId: sprint.id });
    const rb = b.store.createTicket({ projectId: project.value.id, title: 'B', assigneeId: engineer.id, points: 8, sprintId: sprint.id });
    expect(ra.ok && rb.ok).toBe(true);
    await Promise.all([a.store.flush(), b.store.flush()]);

    const rejected = [...a.errors, ...b.errors];
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toBeInstanceOf(WriteConflictError);
    await until(() => a.store.data.tickets.length === 1 && b.store.data.tickets.length === 1);
    expect(a.store.data.tickets[0].id).toBe(b.store.data.tickets[0].id);
    const used = summarizeSprintCapacity(a.store.data, a.store.activeSprint!).members.find((m) => m.member.id === engineer.id)!.used;
    expect(used).toBe(8);

    // After the reload, the rejected person can carry on normally.
    const loser = a.errors.length ? a : b;
    const retry = loser.store.createTicket({ projectId: project.value.id, title: 'B, smaller', assigneeId: engineer.id, points: 2, sprintId: sprint.id });
    expect(retry.ok).toBe(true);
    await loser.store.flush();
    expect(loser.errors).toHaveLength(1);
    await until(() => a.store.data.tickets.length === 2 && b.store.data.tickets.length === 2);
  });

  it('keeps the workspace on disk across restarts', async () => {
    const first = await startServer();
    const a = await connect(first.url);
    a.store.createProject({ name: 'Persisted', sectionId: a.store.data.sections[0].id });
    await a.store.flush();
    a.store.dispose();
    await first.close();

    const second = await startServer(first.dir);
    const b = await connect(second.url);
    expect(b.store.data.projects.map((p) => p.name)).toEqual(['Persisted']);
    const backups = await fs.readdir(path.join(first.dir, 'backups'));
    expect(backups.length).toBeLessThanOrEqual(1);
  });

  it('refuses writes based on an old revision and invalid workspaces', async () => {
    const { url } = await startServer();
    await connect(url);
    const stale = await fetch(`${url}/api/changes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'x', baseRevision: 0, changes: {} }),
    });
    expect(stale.status).toBe(409);
    const { revision } = (await (await fetch(`${url}/api/workspace`)).json()) as { revision: number };
    const invalid = await fetch(`${url}/api/workspace`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'x', baseRevision: revision, data: { nope: true } }),
    });
    expect(invalid.status).toBe(400);
  });
});
