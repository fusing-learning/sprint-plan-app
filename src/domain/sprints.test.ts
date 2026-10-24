import { describe, expect, it } from 'vitest';
import { carryAllDecisions, closeSprint, SprintClosureError, suggestNextSprint } from './sprints';
import { fixture, ticket } from './testFixtures';

describe('closing a sprint', () => {
  function setup() {
    const f = fixture();
    const done = ticket(f, { title: 'Done work', assigneeId: f.a.id, points: 3, sprintId: f.active.id });
    const wip = ticket(f, { title: 'WIP', assigneeId: f.b.id, points: 2, sprintId: f.active.id });
    const todo = ticket(f, { title: 'Not started', assigneeId: null, points: null, sprintId: f.active.id });
    const backlog = ticket(f, { title: 'Backlog', assigneeId: f.a.id, points: 5 });
    f.data.tickets = [done, wip, todo, backlog];
    return { f, done, wip, todo, backlog };
  }

  it('captures an immutable snapshot of tasks, SP, assignments and capacity', () => {
    const { f, done, wip, todo } = setup();
    const result = closeSprint(f.data, f.active.id, { [wip.id]: { type: 'backlog' }, [todo.id]: { type: 'backlog' } }, new Date('2026-01-18T17:00:00Z'));
    const snap = result.sprint.snapshot!;
    expect(result.sprint.status).toBe('closed');
    expect(snap.tickets).toHaveLength(3);
    expect(snap.totalCapacity).toBe(40);
    expect(snap.committedPoints).toBe(5);
    expect(snap.completedPoints).toBe(3);
    expect(snap.incompletePoints).toBe(2);
    expect(snap.members.find((m) => m.memberId === f.a.id)).toMatchObject({ planned: 3, completed: 3, capacity: 10 });
    expect(snap.tickets.find((t) => t.ticketId === done.id)).toMatchObject({ title: 'Done work', assigneeName: 'Engineer A', points: 3, outcome: 'completed' });
  });

  it('treats tasks as done unless told otherwise', () => {
    const { f } = setup();
    const result = closeSprint(f.data, f.active.id, {});
    expect(result.ticketUpdates).toHaveLength(0);
    expect(result.sprint.snapshot!.completedPoints).toBe(5);
  });

  it('snapshot is unaffected by later ticket edits', () => {
    const { f, done } = setup();
    const result = closeSprint(f.data, f.active.id, {});
    done.title = 'Renamed later';
    done.points = 8;
    const doneSnap = result.sprint.snapshot!.tickets.find((t) => t.ticketId === done.id)!;
    expect(doneSnap.title).toBe('Done work');
    expect(doneSnap.points).toBe(3);
  });

  it('done tasks stay with the closed sprint; backlog decisions release them', () => {
    const { f, done, wip } = setup();
    const result = closeSprint(f.data, f.active.id, { [wip.id]: { type: 'backlog' } });
    expect(result.ticketUpdates.map((t) => t.id)).toEqual([wip.id]);
    expect(result.ticketUpdates[0].sprintId).toBeNull();
    expect(result.ticketUpdates.find((t) => t.id === done.id)).toBeUndefined();
  });

  it('carries unfinished work forward by moving it, never duplicating it', () => {
    const { f, wip } = setup();
    const result = closeSprint(f.data, f.active.id, { [wip.id]: { type: 'carry', sprintId: f.future.id } });
    const moved = result.ticketUpdates.find((t) => t.id === wip.id)!;
    expect(moved.sprintId).toBe(f.future.id);
    const after = f.data.tickets.map((t) => result.ticketUpdates.find((u) => u.id === t.id) ?? t);
    expect(after.filter((t) => t.title === 'WIP')).toHaveLength(1);
    expect(after.length).toBe(f.data.tickets.length);
    const snap = result.sprint.snapshot!.tickets.find((t) => t.ticketId === wip.id)!;
    expect(snap.outcome).toBe('carried_forward');
    expect(snap.carriedToSprintName).toBe('Sprint 2');
  });

  it('allows carry-over past the next sprint capacity and reports it', () => {
    const { f, wip } = setup();
    f.data.tickets.push(ticket(f, { assigneeId: f.b.id, points: 9, sprintId: f.future.id }));
    const result = closeSprint(f.data, f.active.id, { [wip.id]: { type: 'carry', sprintId: f.future.id } });
    expect(result.ticketUpdates.find((t) => t.id === wip.id)?.sprintId).toBe(f.future.id);
    expect(result.overCapacity).toHaveLength(1);
    expect(result.overCapacity[0]).toMatchObject({ memberId: f.b.id, sprintId: f.future.id, overBy: 1 });
  });

  it('carryAllDecisions carries every task, even past capacity', () => {
    const { f, wip, todo, done } = setup();
    f.data.tickets.push(ticket(f, { assigneeId: f.b.id, points: 9, sprintId: f.future.id }));
    const decisions = carryAllDecisions(f.data, f.active.id, f.future.id);
    for (const t of [wip, todo, done]) expect(decisions[t.id]).toEqual({ type: 'carry', sprintId: f.future.id });
  });

  it('still rejects carrying to a sprint that is not planned', () => {
    const { f, wip } = setup();
    expect(() => closeSprint(f.data, f.active.id, { [wip.id]: { type: 'carry', sprintId: f.active.id } })).toThrow(SprintClosureError);
  });

  it('only the active sprint can be closed', () => {
    const { f } = setup();
    expect(() => closeSprint(f.data, f.future.id, {})).toThrow(/Only the active sprint/);
  });
});

describe('suggestNextSprint', () => {
  it('starts the day after the latest sprint and lasts two weeks', () => {
    const f = fixture();
    expect(suggestNextSprint(f.data.sprints)).toEqual({ name: 'Sprint 3', startDate: '2026-02-02', endDate: '2026-02-15' });
  });
});
