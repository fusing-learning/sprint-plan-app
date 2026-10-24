import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { SprintFlowDB } from '@/data/db';
import { DexiePlanningRepository } from '@/data/dexieRepository';
import { MemoryPlanningRepository } from '@/data/memoryRepository';
import { summarizeSprintCapacity } from '@/domain/capacity';
import { parseBackup } from '@/domain/backup';
import { PlanningStore } from './planningStore';

let dbCounter = 0;
function dexieStore() {
  const name = `sprintflow-test-${++dbCounter}`;
  const repo = new DexiePlanningRepository(new SprintFlowDB(name));
  return { store: new PlanningStore(repo, () => new Date('2026-10-22T09:00:00Z')), repo, name };
}

function used(store: PlanningStore, memberId: string, sprintId?: string) {
  const sprint = store.data.sprints.find((s) => (sprintId ? s.id === sprintId : s.status === 'active'))!;
  return summarizeSprintCapacity(store.data, sprint).members.find((m) => m.member.id === memberId)!;
}

async function emptyStore() {
  const store = new PlanningStore(new MemoryPlanningRepository(), () => new Date('2026-10-22T09:00:00Z'));
  await store.init();
  store.clearWorkspace();
  const sprint = store.createSprint({ name: 'Sprint 1', startDate: '2026-10-19', endDate: '2026-11-01' });
  if (!sprint.ok) throw new Error(sprint.error);
  store.activateSprint(sprint.value.id);
  const future = store.createSprint({ name: 'Sprint 2', startDate: '2026-11-02', endDate: '2026-11-15' });
  if (!future.ok) throw new Error(future.error);
  const project = store.createProject({ name: 'Checkout', sectionId: store.data.sections[0].id });
  if (!project.ok) throw new Error(project.error);
  const [pm, a, b] = [...store.data.members].sort((x, y) => x.order - y.order);
  return { store, active: sprint.value, future: future.value, project: project.value, pm, a, b };
}

describe('workspace setup', () => {
  it('starts clean on first launch: team, sections and one empty active sprint', async () => {
    const { store } = dexieStore();
    await store.init();
    expect(store.data.projects).toHaveLength(0);
    expect(store.data.tickets).toHaveLength(0);
    expect(store.data.members).toHaveLength(4);
    expect(store.data.sections).toHaveLength(5);
    expect(store.data.sprints).toHaveLength(1);
    expect(store.activeSprint?.name).toBe('Sprint 1');
  });

  it('demo data is opt-in and nobody is over capacity', async () => {
    const { store } = dexieStore();
    await store.init();
    store.loadDemoData();
    const active = store.data.sprints.find((s) => s.status === 'active')!;
    expect(store.data.sprints.filter((s) => s.status === 'planned')).toHaveLength(2);
    expect(store.data.sections).toHaveLength(5);
    const summary = summarizeSprintCapacity(store.data, active);
    expect(summary.totalUsed).toBeGreaterThan(15);
    for (const m of summary.members) expect(m.used).toBeLessThanOrEqual(m.capacity);
  });

  it('clear everything leaves a fresh empty sprint and survives reload', async () => {
    const { store, name } = dexieStore();
    await store.init();
    store.loadDemoData();
    store.updateMember([...store.data.members].sort((a, b) => a.order - b.order)[0].id, { name: 'Priya' });
    store.clearWorkspace();
    await store.flush();
    const reopened = new PlanningStore(new DexiePlanningRepository(new SprintFlowDB(name)));
    await reopened.init();
    expect(reopened.data.projects).toHaveLength(0);
    expect(reopened.data.tickets).toHaveLength(0);
    expect(reopened.data.sprints.map((s) => `${s.name}:${s.status}`)).toEqual(['Sprint 1:active']);
    expect(reopened.data.members.some((m) => m.name === 'Priya')).toBe(true);
  });
});

describe('planning flow through the store', () => {
  it('assigning, re-estimating, reassigning and removing update capacity immediately', async () => {
    const { store, project, a, b } = await emptyStore();
    const active = store.activeSprint!;
    const t = store.createTicket({ projectId: project.id, title: 'Build payment form' });
    expect(t.ok).toBe(true);
    if (!t.ok) return;

    store.updateTicket(t.value.id, { assigneeId: a.id, points: 3 });
    expect(used(store, a.id).used).toBe(0); // created without a sprint, so it's in the backlog

    store.updateTicket(t.value.id, { sprintId: active.id });
    expect(used(store, a.id).used).toBe(3);

    store.updateTicket(t.value.id, { points: 5 });
    expect(used(store, a.id).used).toBe(5);

    store.updateTicket(t.value.id, { assigneeId: b.id });
    expect(used(store, a.id).used).toBe(0);
    expect(used(store, b.id).used).toBe(5);

    store.updateTicket(t.value.id, { sprintId: null });
    expect(used(store, b.id).used).toBe(0);
  });

  it('allows going over capacity and returns a warning', async () => {
    const { store, project, a } = await emptyStore();
    const active = store.activeSprint!;
    const first = store.createTicket({ projectId: project.id, title: 'Big', assigneeId: a.id, points: 8, sprintId: active.id });
    expect(first.ok && first.warning).toBeFalsy();
    const res = store.createTicket({ projectId: project.id, title: 'Too much', assigneeId: a.id, points: 3, sprintId: active.id });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.warning).toBe('Engineer A is now at 11 / 10 SP in Sprint 1, 1 SP over capacity.');
    expect(store.data.tickets).toHaveLength(2);
    expect(used(store, a.id)).toMatchObject({ used: 11, remaining: -1, state: 'over' });

    // Edits that don't add SP on top of an over allocation don't warn again.
    const shrink = store.updateTicket(res.value.id, { points: 2 });
    expect(shrink.ok && shrink.warning).toBeFalsy();
  });

  it('duplicates into the same open sprint', async () => {
    const { store, project, a } = await emptyStore();
    const active = store.activeSprint!;
    const t = store.createTicket({ projectId: project.id, title: 'Work', assigneeId: a.id, points: 6, sprintId: active.id });
    if (!t.ok) throw new Error(t.error);
    const copy = store.duplicateTicket(t.value.id);
    expect(copy.ok).toBe(true);
    if (!copy.ok) return;
    expect(copy.value.sprintId).toBe(active.id);
    expect(copy.warning).toContain('2 SP over capacity');
  });

  it('future sprint planning does not change active capacity', async () => {
    const { store, project, a, future } = await emptyStore();
    store.createTicket({ projectId: project.id, title: 'Next', assigneeId: a.id, points: 6, sprintId: future.id });
    expect(used(store, a.id).used).toBe(0);
    expect(used(store, a.id, future.id).used).toBe(6);
  });

  it('lowering capacity below what is allocated is allowed with a warning; above 10 is still invalid', async () => {
    const { store, project, a } = await emptyStore();
    const active = store.activeSprint!;
    const leave = store.updateSprint(active.id, { capacities: { [a.id]: 6 } });
    expect(leave.ok && leave.warning).toBeFalsy();
    expect(used(store, a.id).capacity).toBe(6);
    store.createTicket({ projectId: project.id, title: 'y', assigneeId: a.id, points: 5, sprintId: active.id });
    const lower = store.updateSprint(active.id, { capacities: { [a.id]: 4 } });
    expect(lower.ok).toBe(true);
    if (lower.ok) expect(lower.warning).toBe('Over capacity in Sprint 1: Engineer A 5 / 4 SP.');
    expect(used(store, a.id)).toMatchObject({ capacity: 4, used: 5, state: 'over' });
    expect(store.updateSprint(active.id, { capacities: { [a.id]: 12 } }).ok).toBe(false);
  });

  it('lowering a default capacity below open allocations is allowed with a warning', async () => {
    const { store, project, a } = await emptyStore();
    store.createTicket({ projectId: project.id, title: 'y', assigneeId: a.id, points: 5, sprintId: store.activeSprint!.id });
    const res = store.updateMember(a.id, { defaultCapacity: 3 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.warning).toBe('Over capacity in Sprint 1: Engineer A 5 / 3 SP.');
  });

  it('only one sprint can be active at a time', async () => {
    const { store, future } = await emptyStore();
    const res = store.activateSprint(future.id);
    expect(res.ok).toBe(false);
  });

  it('activates an over-allocated sprint and closes with over-capacity carry-over, warning both times', async () => {
    const { store, project, a, future } = await emptyStore();
    const active = store.activeSprint!;
    store.createTicket({ projectId: project.id, title: 'Next', assigneeId: a.id, points: 8, sprintId: future.id });
    const wip = store.createTicket({ projectId: project.id, title: 'WIP', assigneeId: a.id, points: 4, sprintId: active.id });
    if (!wip.ok) throw new Error(wip.error);

    const closed = store.closeSprint(active.id, { [wip.value.id]: { type: 'carry', sprintId: future.id } });
    expect(closed.ok).toBe(true);
    if (closed.ok) expect(closed.warning).toBe('Over capacity in Sprint 2: Engineer A 12 / 10 SP.');
    expect(store.data.tickets.find((t) => t.id === wip.value.id)!.sprintId).toBe(future.id);

    const activated = store.activateSprint(future.id);
    expect(activated.ok).toBe(true);
    if (activated.ok) expect(activated.warning).toBe('Over capacity in Sprint 2: Engineer A 12 / 10 SP.');
    expect(store.activeSprint?.id).toBe(future.id);
  });

  it('closing a sprint preserves the snapshot and carries work forward without duplication', async () => {
    const { store, project, a, future } = await emptyStore();
    const active = store.activeSprint!;
    const done = store.createTicket({ projectId: project.id, title: 'Done', assigneeId: a.id, points: 2, sprintId: active.id });
    const wip = store.createTicket({ projectId: project.id, title: 'WIP', assigneeId: a.id, points: 3, sprintId: active.id });
    if (!done.ok || !wip.ok) throw new Error('setup');
    const res = store.closeSprint(active.id, { [wip.value.id]: { type: 'carry', sprintId: future.id } }, future.id);
    expect(res.ok).toBe(true);
    const closed = store.data.sprints.find((s) => s.id === active.id)!;
    expect(closed.status).toBe('closed');
    expect(store.activeSprint?.id).toBe(future.id);
    expect(store.data.tickets.filter((t) => t.title === 'WIP')).toHaveLength(1);
    expect(store.data.tickets.find((t) => t.id === wip.value.id)!.sprintId).toBe(future.id);
    expect(used(store, a.id).used).toBe(3);

    store.updateTicket(done.value.id, { title: 'Changed after close' });
    const snap = store.data.sprints.find((s) => s.id === active.id)!.snapshot!;
    expect(snap.tickets.find((t) => t.ticketId === done.value.id)!.title).toBe('Done');
    expect(snap.completedPoints).toBe(2);
    expect(store.updateSprint(active.id, { name: 'edit' }).ok).toBe(false);
    expect(store.updateTicket(wip.value.id, { sprintId: active.id }).ok).toBe(false);
  });

  it('section deletion requires moving projects first', async () => {
    const { store, project } = await emptyStore();
    const [first, second] = [...store.data.sections].sort((x, y) => x.order - y.order);
    expect(store.deleteSection(first.id).ok).toBe(false);
    expect(store.deleteSection(first.id, second.id).ok).toBe(true);
    expect(store.data.projects.find((p) => p.id === project.id)!.sectionId).toBe(second.id);
  });
});

describe('persistence', () => {
  it('survives reload from IndexedDB', async () => {
    const { store, name } = dexieStore();
    await store.init();
    store.loadDemoData();
    const active = store.activeSprint!;
    const pm = [...store.data.members].sort((x, y) => x.order - y.order)[0];
    const project = store.createProject({ name: 'Persisted project', sectionId: store.data.sections[0].id });
    if (!project.ok) throw new Error(project.error);
    const before = used(store, pm.id).used;
    const t = store.createTicket({ projectId: project.value.id, title: 'Persisted ticket', assigneeId: pm.id, points: 0.5, sprintId: active.id });
    expect(t.ok).toBe(true);
    store.updateMember(pm.id, { name: 'Priya (PM)' });
    await store.flush();

    const reopened = new PlanningStore(new DexiePlanningRepository(new SprintFlowDB(name)));
    await reopened.init();
    expect(reopened.data.projects.some((p) => p.name === 'Persisted project')).toBe(true);
    expect(reopened.data.tickets.find((x) => x.title === 'Persisted ticket')?.sprintId).toBe(active.id);
    expect(reopened.data.members.find((m) => m.id === pm.id)!.name).toBe('Priya (PM)');
    expect(used(reopened, pm.id).used).toBe(before + 0.5);
  });

  it('export and import round-trip through validation', async () => {
    const { store } = dexieStore();
    await store.init();
    store.loadDemoData();
    const backup = JSON.stringify(store.exportBackup());
    const parsed = parseBackup(backup);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.tickets).toHaveLength(store.data.tickets.length);
    expect(parseBackup('{"nope":1}').ok).toBe(false);
    expect(parseBackup('not json').ok).toBe(false);
    const broken = JSON.parse(backup);
    broken.data.tickets[0].points = -2;
    expect(parseBackup(broken).ok).toBe(false);
  });
});

describe('schema v1 backups', () => {
  it('import with removed fields stripped', () => {
    const f = { app: 'sprintflow', schemaVersion: 1, exportedAt: '2026-01-01T00:00:00Z', data: null as unknown };
    const ts = '2026-01-01T00:00:00Z';
    f.data = {
      meta: { id: 'app', schemaVersion: 1, initialized: true, nextTicketNumber: 2, ticketKeyPrefix: 'SF' },
      members: [{ id: 'm1', name: 'PM', role: 'PM', defaultCapacity: 10, order: 0, createdAt: ts, updatedAt: ts }],
      sections: [{ id: 's1', name: 'P0', description: '', color: 'rose', order: 0, createdAt: ts, updatedAt: ts }],
      projects: [{ id: 'p1', name: 'P', description: '', sectionId: 's1', lifecycle: 'active', targetDate: null, owner: '', order: 0, external: {}, createdAt: ts, updatedAt: ts }],
      tickets: [
        {
          id: 't1', key: 'SF-1', title: 'T', description: '', acceptanceCriteria: 'x', notes: 'y', projectId: 'p1', assigneeId: 'm1', points: 2,
          sprintId: null, status: 'done', readiness: 'ready', type: 'bug', order: 0, external: {}, createdAt: ts, updatedAt: ts,
        },
      ],
      sprints: [],
    };
    const parsed = parseBackup(f);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.tickets[0]).not.toHaveProperty('status');
    expect(parsed.data.tickets[0]).not.toHaveProperty('readiness');
    expect(parsed.data.meta.schemaVersion).toBe(2);
  });
});
