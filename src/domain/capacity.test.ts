import { describe, expect, it } from 'vitest';
import {
  consumesCapacity,
  findCapacityConflict,
  findCapacityReductionConflicts,
  isValidPoints,
  memberAllocation,
  parsePoints,
  summarizeSprintCapacity,
} from './capacity';
import { fixture, ticket } from './testFixtures';

describe('active sprint capacity calculation', () => {
  it('sums assigned + estimated tickets per member and derives remaining', () => {
    const f = fixture();
    f.data.tickets = [
      ticket(f, { assigneeId: f.a.id, points: 3, sprintId: f.active.id }),
      ticket(f, { assigneeId: f.a.id, points: 2.5, sprintId: f.active.id }),
      ticket(f, { assigneeId: f.b.id, points: 5, sprintId: f.active.id }),
    ];
    const s = summarizeSprintCapacity(f.data, f.active);
    const a = s.members.find((m) => m.member.id === f.a.id)!;
    expect(a.used).toBe(5.5);
    expect(a.remaining).toBe(4.5);
    expect(s.totalCapacity).toBe(40);
    expect(s.totalUsed).toBe(10.5);
    expect(s.totalRemaining).toBe(29.5);
  });

  it('flags low and full capacity states', () => {
    const f = fixture();
    f.data.tickets = [
      ticket(f, { assigneeId: f.a.id, points: 8, sprintId: f.active.id }),
      ticket(f, { assigneeId: f.b.id, points: 10, sprintId: f.active.id }),
    ];
    const s = summarizeSprintCapacity(f.data, f.active);
    expect(s.members.find((m) => m.member.id === f.a.id)!.state).toBe('low');
    expect(s.members.find((m) => m.member.id === f.b.id)!.state).toBe('full');
    expect(s.members.find((m) => m.member.id === f.c.id)!.state).toBe('ok');
  });

  it('counts unassigned and unestimated sprint tickets separately without consuming capacity', () => {
    const f = fixture();
    f.data.tickets = [
      ticket(f, { assigneeId: null, points: 3, sprintId: f.active.id }),
      ticket(f, { assigneeId: f.a.id, points: null, sprintId: f.active.id }),
    ];
    const s = summarizeSprintCapacity(f.data, f.active);
    expect(s.totalUsed).toBe(0);
    expect(s.unassigned).toEqual({ count: 1, points: 3 });
    expect(s.unestimated).toEqual({ count: 1 });
  });
});

describe('backlog and future sprint isolation', () => {
  it('backlog tickets do not consume capacity even when assigned and estimated', () => {
    const f = fixture();
    f.data.tickets = [ticket(f, { assigneeId: f.a.id, points: 8, sprintId: null })];
    expect(memberAllocation(f.data.tickets, f.active.id, f.a.id)).toBe(0);
    expect(consumesCapacity(f.data.tickets[0], f.active.id)).toBe(false);
  });

  it('future sprint tickets do not change active sprint capacity', () => {
    const f = fixture();
    f.data.tickets = [
      ticket(f, { assigneeId: f.a.id, points: 4, sprintId: f.active.id }),
      ticket(f, { assigneeId: f.a.id, points: 6, sprintId: f.future.id }),
    ];
    const active = summarizeSprintCapacity(f.data, f.active);
    const future = summarizeSprintCapacity(f.data, f.future);
    expect(active.members.find((m) => m.member.id === f.a.id)!.used).toBe(4);
    expect(future.members.find((m) => m.member.id === f.a.id)!.used).toBe(6);
  });

  it('future sprint allocation is checked against the future sprint, not the active one', () => {
    const f = fixture();
    f.data.tickets = [ticket(f, { assigneeId: f.a.id, points: 10, sprintId: f.active.id })];
    const proposed = ticket(f, { assigneeId: f.a.id, points: 5, sprintId: f.future.id });
    expect(findCapacityConflict(f.data, proposed)).toBeNull();
  });
});

describe('free-text story points', () => {
  it('sums arbitrary decimals without float noise', () => {
    const f = fixture();
    f.data.tickets = [
      ticket(f, { assigneeId: f.a.id, points: 0.1, sprintId: f.active.id }),
      ticket(f, { assigneeId: f.a.id, points: 0.2, sprintId: f.active.id }),
      ticket(f, { assigneeId: f.a.id, points: 1.25, sprintId: f.active.id }),
    ];
    const a = summarizeSprintCapacity(f.data, f.active).members.find((m) => m.member.id === f.a.id)!;
    expect(a.used).toBe(1.55);
    expect(a.remaining).toBe(8.45);
  });

  it('parses typed values', () => {
    expect(parsePoints('')).toEqual({ ok: true, value: null });
    expect(parsePoints(' 3 ')).toEqual({ ok: true, value: 3 });
    expect(parsePoints('2,5')).toEqual({ ok: true, value: 2.5 });
    expect(parsePoints('0.333')).toEqual({ ok: true, value: 0.33 });
    expect(parsePoints('abc').ok).toBe(false);
    expect(parsePoints('0').ok).toBe(false);
    expect(parsePoints('-1').ok).toBe(false);
    expect(parsePoints('11').ok).toBe(false);
  });
});

describe('over-capacity prevention', () => {
  it('reports a conflict with remaining points when a ticket would exceed capacity', () => {
    const f = fixture();
    f.data.tickets = [ticket(f, { assigneeId: f.a.id, points: 8, sprintId: f.active.id })];
    const conflict = findCapacityConflict(f.data, ticket(f, { assigneeId: f.a.id, points: 3, sprintId: f.active.id }));
    expect(conflict).not.toBeNull();
    expect(conflict!.remaining).toBe(2);
    expect(conflict!.overBy).toBe(1);
  });

  it('allows filling capacity exactly', () => {
    const f = fixture();
    f.data.tickets = [ticket(f, { assigneeId: f.a.id, points: 8, sprintId: f.active.id })];
    expect(findCapacityConflict(f.data, ticket(f, { assigneeId: f.a.id, points: 2, sprintId: f.active.id }))).toBeNull();
  });

  it('does not double count the ticket being edited', () => {
    const f = fixture();
    const t = ticket(f, { assigneeId: f.a.id, points: 6, sprintId: f.active.id });
    f.data.tickets = [t];
    expect(findCapacityConflict(f.data, { ...t, points: 10 })).toBeNull();
  });
});

describe('reduced capacity for leave', () => {
  it('uses the per-sprint override and blocks allocations beyond it', () => {
    const f = fixture();
    f.active.capacities[f.b.id] = 6;
    f.data.tickets = [ticket(f, { assigneeId: f.b.id, points: 5, sprintId: f.active.id })];
    const b = summarizeSprintCapacity(f.data, f.active).members.find((m) => m.member.id === f.b.id)!;
    expect(b.capacity).toBe(6);
    expect(b.isReduced).toBe(true);
    expect(b.remaining).toBe(1);
    expect(findCapacityConflict(f.data, ticket(f, { assigneeId: f.b.id, points: 2, sprintId: f.active.id }))).not.toBeNull();
  });

  it('never allows capacity above 10', () => {
    const f = fixture();
    f.active.capacities[f.a.id] = 14;
    const a = summarizeSprintCapacity(f.data, f.active).members.find((m) => m.member.id === f.a.id)!;
    expect(a.capacity).toBe(10);
  });

  it('detects reductions below what is already allocated', () => {
    const f = fixture();
    f.data.tickets = [ticket(f, { assigneeId: f.a.id, points: 7, sprintId: f.active.id })];
    expect(findCapacityReductionConflicts(f.data, f.active, { [f.a.id]: 6 })).toHaveLength(1);
    expect(findCapacityReductionConflicts(f.data, f.active, { [f.a.id]: 7 })).toHaveLength(0);
  });
});

describe('points validation', () => {
  it('accepts any number above 0 up to 10 (2 decimals) and unestimated', () => {
    expect(isValidPoints(null)).toBe(true);
    expect(isValidPoints(0.3)).toBe(true);
    expect(isValidPoints(10)).toBe(true);
    expect(isValidPoints(0)).toBe(false);
    expect(isValidPoints(0.333)).toBe(false);
    expect(isValidPoints(10.5)).toBe(false);
  });
});
