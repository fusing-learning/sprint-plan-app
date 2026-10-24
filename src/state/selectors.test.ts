import { describe, expect, it } from 'vitest';
import { fixture, ticket } from '@/domain/testFixtures';
import type { Filters } from './react';
import { hasActiveFilters, ticketMatches } from './selectors';

const base: Filters = { scope: 'sprint', assignee: 'all', gap: 'none', showArchived: false };

describe('board scope', () => {
  const f = fixture();
  const inActive = ticket(f, { sprintId: f.active.id, assigneeId: f.a.id, points: 2 });
  const inFuture = ticket(f, { sprintId: f.future.id });
  const backlog = ticket(f, {});
  const match = (t: typeof backlog, filters: Partial<Filters>, sprintId: string | null = f.active.id) => ticketMatches(t, { ...base, ...filters }, '', sprintId, false);

  it('shows only the planning sprint by default, and that is not an active filter', () => {
    expect([inActive, inFuture, backlog].map((t) => match(t, {}))).toEqual([true, false, false]);
    expect(match(inFuture, {}, f.future.id)).toBe(true);
    expect(hasActiveFilters(base, '')).toBe(false);
  });

  it('shows only backlog tasks in the backlog scope', () => {
    expect([inActive, inFuture, backlog].map((t) => match(t, { scope: 'backlog' }))).toEqual([false, false, true]);
    expect(hasActiveFilters({ ...base, scope: 'backlog' }, '')).toBe(true);
  });

  it('falls back to the backlog when there is no sprint to plan', () => {
    expect([inActive, backlog].map((t) => match(t, {}, null))).toEqual([false, true]);
  });

  it('incomplete planning matches sprint tasks missing an assignee or SP', () => {
    const noOwner = ticket(f, { sprintId: f.active.id, points: 1 });
    const noSp = ticket(f, { sprintId: f.active.id, assigneeId: f.a.id });
    const backlogGap = ticket(f, {});
    expect([inActive, noOwner, noSp, backlogGap].map((t) => match(t, { gap: 'incomplete' }))).toEqual([false, true, true, false]);
  });
});
