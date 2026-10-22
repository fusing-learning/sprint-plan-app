import { addDays, format, parseISO, startOfWeek } from 'date-fns';
import { findCapacityConflict, memberCapacityFor, roundPoints, consumesCapacity, type CapacityConflict } from './capacity';
import { boardOrder } from './ordering';
import type { AppData, ID, SnapshotTicket, Sprint, SprintSnapshot, Ticket } from './types';

export const SPRINT_LENGTH_DAYS = 14;

export function sprintEndFromStart(startDate: string): string {
  return format(addDays(parseISO(startDate), SPRINT_LENGTH_DAYS - 1), 'yyyy-MM-dd');
}

/** Monday of the current week — the default start of a first sprint. */
export function currentSprintStart(today: Date = new Date()): string {
  return format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

/** Suggest the next sprint's name and dates based on the latest existing sprint. */
export function suggestNextSprint(sprints: Sprint[], today: Date = new Date()): { name: string; startDate: string; endDate: string } {
  const latest = [...sprints].sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
  const startDate = latest ? format(addDays(parseISO(latest.endDate), 1), 'yyyy-MM-dd') : currentSprintStart(today);
  const numbers = sprints
    .map((s) => /(\d+)\s*$/.exec(s.name)?.[1])
    .filter((n): n is string => !!n)
    .map(Number);
  const next = numbers.length ? Math.max(...numbers) + 1 : sprints.length + 1;
  return { name: `Sprint ${next}`, startDate, endDate: sprintEndFromStart(startDate) };
}

export function isOpenSprint(s: Sprint): boolean {
  return s.status === 'active' || s.status === 'planned';
}

/**
 * What happens to each task when a sprint closes. SprintFlow does not track
 * progress, so the person closing the sprint says what got done.
 * - done: stays with the closed sprint as completed history (default)
 * - backlog: unfinished, returns to the backlog
 * - carry: unfinished, moves (never copies) to a planned sprint
 */
export type CloseDecision = { type: 'done' } | { type: 'backlog' } | { type: 'carry'; sprintId: ID };

export interface SprintClosureResult {
  sprint: Sprint;
  ticketUpdates: Ticket[];
}

export class SprintClosureError extends Error {
  constructor(
    message: string,
    public readonly conflicts: CapacityConflict[] = [],
  ) {
    super(message);
    this.name = 'SprintClosureError';
  }
}

export function sprintTickets(data: Pick<AppData, 'tickets' | 'sections' | 'projects'>, sprintId: ID): Ticket[] {
  return data.tickets.filter((t) => t.sprintId === sprintId).sort(boardOrder(data));
}

/**
 * Pure function: compute the closed sprint (with an immutable snapshot) and the
 * ticket updates required to close it. Carry-over is capacity-checked against
 * the target sprint; unfinished work is moved, so it is never duplicated.
 */
export function closeSprint(data: AppData, sprintId: ID, decisions: Record<ID, CloseDecision>, now: Date = new Date()): SprintClosureResult {
  const sprint = data.sprints.find((s) => s.id === sprintId);
  if (!sprint) throw new SprintClosureError('Sprint not found.');
  if (sprint.status !== 'active') throw new SprintClosureError('Only the active sprint can be closed.');

  const nowIso = now.toISOString();
  const tickets = sprintTickets(data, sprintId);
  const projectById = new Map(data.projects.map((p) => [p.id, p]));
  const sectionById = new Map(data.sections.map((s) => [s.id, s]));
  const memberById = new Map(data.members.map((m) => [m.id, m]));
  const sprintById = new Map(data.sprints.map((s) => [s.id, s]));
  const decisionFor = (t: Ticket): CloseDecision => decisions[t.id] ?? { type: 'done' };

  const ticketUpdates: Ticket[] = [];
  for (const t of tickets) {
    const decision = decisionFor(t);
    if (decision.type === 'done') continue;
    if (decision.type === 'carry') {
      const target = sprintById.get(decision.sprintId);
      if (!target || target.status !== 'planned') {
        throw new SprintClosureError(`"${t.title}" can only be carried forward to a planned sprint.`);
      }
      ticketUpdates.push({ ...t, sprintId: target.id, updatedAt: nowIso });
    } else {
      ticketUpdates.push({ ...t, sprintId: null, updatedAt: nowIso });
    }
  }

  // Capacity check carried-over work, applying moves one at a time.
  const conflicts: CapacityConflict[] = [];
  let working = data.tickets;
  for (const update of ticketUpdates) {
    if (update.sprintId === null) continue;
    const conflict = findCapacityConflict({ ...data, tickets: working }, update);
    if (conflict) conflicts.push(conflict);
    working = working.map((t) => (t.id === update.id ? update : t));
  }
  if (conflicts.length) {
    throw new SprintClosureError('Carrying these tasks forward would exceed capacity in the next sprint.', conflicts);
  }

  const isDone = (t: Ticket) => decisionFor(t).type === 'done';
  const updateById = new Map(ticketUpdates.map((t) => [t.id, t]));
  const snapshotTickets: SnapshotTicket[] = tickets.map((t) => {
    const project = projectById.get(t.projectId);
    const section = project ? sectionById.get(project.sectionId) : undefined;
    const member = t.assigneeId ? memberById.get(t.assigneeId) : undefined;
    const moved = updateById.get(t.id);
    const carriedTo = moved?.sprintId ? sprintById.get(moved.sprintId) : undefined;
    return {
      ticketId: t.id,
      key: t.key,
      title: t.title,
      projectId: t.projectId,
      projectName: project?.name ?? 'Deleted project',
      sectionName: section?.name ?? '—',
      assigneeId: t.assigneeId,
      assigneeName: member?.name ?? null,
      points: t.points,
      outcome: isDone(t) ? 'completed' : carriedTo ? 'carried_forward' : 'returned_to_backlog',
      carriedToSprintId: carriedTo?.id ?? null,
      carriedToSprintName: carriedTo?.name ?? null,
    };
  });

  const sum = (list: Ticket[]) => roundPoints(list.reduce((s, t) => s + (t.points ?? 0), 0));
  const members = [...data.members]
    .sort((a, b) => a.order - b.order)
    .map((m) => {
      const own = tickets.filter((t) => t.assigneeId === m.id && consumesCapacity(t, sprintId));
      return {
        memberId: m.id,
        name: m.name,
        role: m.role,
        capacity: memberCapacityFor(sprint, m),
        planned: sum(own),
        completed: sum(own.filter(isDone)),
      };
    });

  const committedPoints = sum(tickets);
  const completedPoints = sum(tickets.filter(isDone));
  const snapshot: SprintSnapshot = {
    closedAt: nowIso,
    sprintName: sprint.name,
    startDate: sprint.startDate,
    endDate: sprint.endDate,
    totalCapacity: roundPoints(members.reduce((s, m) => s + m.capacity, 0)),
    committedPoints,
    completedPoints,
    incompletePoints: roundPoints(committedPoints - completedPoints),
    unestimatedCount: tickets.filter((t) => t.points === null).length,
    unassignedCount: tickets.filter((t) => t.assigneeId === null).length,
    members,
    tickets: snapshotTickets,
  };

  // Detached plain-JSON copy: later edits to live tickets never change history.
  const frozen: SprintSnapshot = JSON.parse(JSON.stringify(snapshot));
  return { sprint: { ...sprint, status: 'closed', snapshot: frozen, updatedAt: nowIso }, ticketUpdates };
}

/**
 * "Carry all forward" plan: carry every task to `targetSprintId` in priority
 * order while it fits; anything that does not fit returns to the backlog.
 */
export function carryAllDecisions(data: AppData, sprintId: ID, targetSprintId: ID): Record<ID, CloseDecision> {
  const decisions: Record<ID, CloseDecision> = {};
  let working = data.tickets;
  for (const t of sprintTickets(data, sprintId)) {
    const moved = { ...t, sprintId: targetSprintId };
    if (findCapacityConflict({ ...data, tickets: working }, moved)) {
      decisions[t.id] = { type: 'backlog' };
    } else {
      decisions[t.id] = { type: 'carry', sprintId: targetSprintId };
      working = working.map((w) => (w.id === t.id ? moved : w));
    }
  }
  return decisions;
}
