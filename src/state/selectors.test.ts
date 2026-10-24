import { describe, expect, it } from 'vitest';
import type { Project } from '@/domain/types';
import { fixture, ticket } from '@/domain/testFixtures';
import { cutLineLedger, describeCutReason, type CutLineLedger } from './selectors';

function project(id: string, order: number, patch: Partial<Project> = {}): Project {
  return { ...fixture().data.projects[0], id, name: id, order, ...patch };
}

function stateOf(ledger: CutLineLedger, id: string) {
  return ledger.sections.flatMap((s) => s.projects.flatMap((p) => p.tasks)).find((t) => t.ticket.id === id)!;
}

describe('cut line ledger', () => {
  it('cuts where team capacity runs out, going top-down', () => {
    const f = fixture();
    f.data.tickets = [f.pm, f.a, f.b, f.c].map((m, i) => ticket(f, { id: `full${i}`, assigneeId: m.id, points: 10 }));
    f.data.tickets.push(ticket(f, { id: 'next', assigneeId: f.a.id, points: 1 }), ticket(f, { id: 'after', assigneeId: f.b.id, points: 2 }));

    const l = cutLineLedger(f.data, f.active);
    expect(l.teamCapacity).toBe(40);
    expect(l.abovePoints).toBe(40);
    expect(l.cut).toEqual({ ticketId: 'next', reason: { kind: 'team', needed: 1, remaining: 0 } });
    expect(describeCutReason(l.cut!.reason)).toBe('Next task needs 1 SP; the team has 0 left.');
    expect(stateOf(l, 'full3').cumulative).toBe(40);
    expect(stateOf(l, 'next').state).toBe('below');
    expect(stateOf(l, 'after').state).toBe('below');
    expect(l.belowPoints).toBe(3);
    expect(l.belowCount).toBe(2);
  });

  it('cuts where one person runs out, even with team capacity left', () => {
    const f = fixture();
    f.data.tickets = [
      ticket(f, { id: 'c1', assigneeId: f.c.id, points: 8 }),
      ticket(f, { id: 'a1', assigneeId: f.a.id, points: 2 }),
      ticket(f, { id: 'c2', assigneeId: f.c.id, points: 3 }),
      // Would fit for B, but it's below the line: planning stops at the first task that doesn't fit.
      ticket(f, { id: 'b1', assigneeId: f.b.id, points: 1 }),
    ];
    const l = cutLineLedger(f.data, f.active);
    expect(l.cut).toEqual({ ticketId: 'c2', reason: { kind: 'member', memberId: f.c.id, memberName: 'Engineer C', needed: 3, remaining: 2 } });
    expect(describeCutReason(l.cut!.reason)).toBe('Next task needs 3 SP from Engineer C, who has 2 left.');
    expect(l.abovePoints).toBe(10);
    expect(stateOf(l, 'b1').state).toBe('below');
    expect(l.members.find((m) => m.member.id === f.c.id)).toMatchObject({ capacity: 10, used: 8, remaining: 2 });
  });

  it('uses the sprint capacity override for leave', () => {
    const f = fixture();
    f.active.capacities = { [f.b.id]: 4 };
    f.data.tickets = [ticket(f, { id: 'b1', assigneeId: f.b.id, points: 3 }), ticket(f, { id: 'b2', assigneeId: f.b.id, points: 2 })];
    const l = cutLineLedger(f.data, f.active);
    expect(l.teamCapacity).toBe(34);
    expect(l.cut?.ticketId).toBe('b2');
    expect(l.cut?.reason).toMatchObject({ kind: 'member', remaining: 1 });
  });

  it('excludes and flags tasks without an assignee or SP; they never trigger the cut', () => {
    const f = fixture();
    f.data.tickets = [
      ticket(f, { id: 'noOwner', assigneeId: null, points: 10 }),
      ticket(f, { id: 'noSp', assigneeId: f.a.id, points: null }),
      ticket(f, { id: 'neither', assigneeId: null, points: null }),
      ticket(f, { id: 'ok', assigneeId: f.a.id, points: 10 }),
    ];
    const l = cutLineLedger(f.data, f.active);
    expect(l.cut).toBeNull();
    expect(l.abovePoints).toBe(10);
    expect(stateOf(l, 'noOwner')).toMatchObject({ state: 'incomplete', missingOwner: true, missingPoints: false, cumulative: null });
    expect(stateOf(l, 'noSp')).toMatchObject({ state: 'incomplete', missingOwner: false, missingPoints: true });
    expect(stateOf(l, 'ok')).toMatchObject({ state: 'counted', cumulative: 10, rank: 4 });
    expect(l.incomplete).toEqual({ count: 3, noOwner: 2, noPoints: 2 });
    expect(l.fillIds).toEqual(['ok']);
  });

  it('only flags incomplete tasks above the line', () => {
    const f = fixture();
    f.data.tickets = [ticket(f, { id: 'big', assigneeId: f.a.id, points: 10 }), ticket(f, { id: 'more', assigneeId: f.a.id, points: 1 }), ticket(f, { id: 'late', assigneeId: null, points: 2 })];
    const l = cutLineLedger(f.data, f.active);
    expect(stateOf(l, 'late').state).toBe('below');
    expect(l.incomplete.count).toBe(0);
    expect(l.belowPoints).toBe(3);
  });

  it('skips on-hold and archived projects and marks all-skipped sections as not this sprint', () => {
    const f = fixture();
    f.data.sections.push({ ...f.data.sections[0], id: 'sec2', name: 'Exploration', order: 1 });
    f.data.projects = [
      project('onHold', 0, { lifecycle: 'on_hold' }),
      project('live', 1),
      project('archived', 0, { sectionId: 'sec2', lifecycle: 'archived' }),
      project('paused', 1, { sectionId: 'sec2', lifecycle: 'on_hold' }),
    ];
    f.data.tickets = [
      ticket(f, { id: 'h', projectId: 'onHold', assigneeId: f.a.id, points: 10 }),
      ticket(f, { id: 'l1', projectId: 'live', assigneeId: f.a.id, points: 6 }),
      ticket(f, { id: 'x', projectId: 'archived', assigneeId: f.a.id, points: 10 }),
      ticket(f, { id: 'p', projectId: 'paused', assigneeId: null, points: null }),
    ];
    const l = cutLineLedger(f.data, f.active);
    expect(stateOf(l, 'h')).toMatchObject({ state: 'excluded', rank: null });
    expect(stateOf(l, 'x').state).toBe('excluded');
    expect(stateOf(l, 'l1')).toMatchObject({ state: 'counted', rank: 1, cumulative: 6 });
    expect(l.cut).toBeNull();
    expect(l.abovePoints).toBe(6);
    expect(l.incomplete.count).toBe(0);
    expect(l.sections.map((s) => s.notThisSprint)).toEqual([false, true]);
    expect(l.sections[0].projects.map((p) => [p.project.id, p.excluded])).toEqual([
      ['onHold', true],
      ['live', false],
    ]);
  });

  it('ranks by section, then project, then task order', () => {
    const f = fixture();
    f.data.sections.push({ ...f.data.sections[0], id: 'sec0', name: 'Top', order: -1 });
    f.data.projects = [project('second', 1), project('first', 0), project('top', 0, { sectionId: 'sec0' })];
    f.data.tickets = [
      ticket(f, { id: 's2', projectId: 'second', order: 0 }),
      ticket(f, { id: 'f2', projectId: 'first', order: 1 }),
      ticket(f, { id: 'f1', projectId: 'first', order: 0 }),
      ticket(f, { id: 't1', projectId: 'top', order: 5 }),
    ];
    const l = cutLineLedger(f.data, f.active);
    const ranks = l.sections.flatMap((s) => s.projects.flatMap((p) => p.tasks.map((t) => [t.ticket.id, t.rank])));
    expect(ranks).toEqual([
      ['t1', 1],
      ['f1', 2],
      ['f2', 3],
      ['s2', 4],
    ]);
  });

  it('ignores tasks in other open sprints and closed sprints; offers only backlog tasks to fill', () => {
    const f = fixture();
    const closed = { ...f.future, id: 's_closed', status: 'closed' as const };
    f.data.sprints.push(closed);
    f.data.tickets = [
      ticket(f, { id: 'in', assigneeId: f.a.id, points: 4, sprintId: f.active.id }),
      ticket(f, { id: 'other', assigneeId: f.a.id, points: 10, sprintId: f.future.id }),
      ticket(f, { id: 'done', assigneeId: f.a.id, points: 10, sprintId: closed.id }),
      ticket(f, { id: 'back', assigneeId: f.a.id, points: 6 }),
    ];
    const l = cutLineLedger(f.data, f.active);
    expect(stateOf(l, 'other')).toMatchObject({ state: 'elsewhere', rank: null });
    expect(stateOf(l, 'done')).toBeUndefined();
    expect(l.abovePoints).toBe(10);
    expect(l.cut).toBeNull();
    expect(l.fillIds).toEqual(['back']);
  });

  it('projects a future sprint against its own capacity', () => {
    const f = fixture();
    f.data.tickets = [
      ticket(f, { id: 'active', assigneeId: f.a.id, points: 9, sprintId: f.active.id }),
      ticket(f, { id: 'planned', assigneeId: f.a.id, points: 9, sprintId: f.future.id }),
      ticket(f, { id: 'back', assigneeId: f.a.id, points: 2 }),
    ];
    const l = cutLineLedger(f.data, f.future);
    expect(stateOf(l, 'active').state).toBe('elsewhere');
    expect(stateOf(l, 'planned').state).toBe('counted');
    expect(l.cut?.ticketId).toBe('back');
  });
});
