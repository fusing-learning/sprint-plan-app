import {
  MAX_MEMBER_CAPACITY,
  type AppData,
  type ID,
  type Member,
  type Sprint,
  type Ticket,
} from './types';

/**
 * Capacity is ALWAYS derived from ticket allocations. Nothing in the data model
 * stores a mutable "remaining" value — every number here is recalculated from
 * the current tickets, sprint capacity settings and members.
 */

export type CapacityState = 'empty' | 'ok' | 'low' | 'full' | 'over';

export interface MemberCapacity {
  member: Member;
  capacity: number;
  defaultCapacity: number;
  isReduced: boolean;
  used: number;
  remaining: number;
  ticketCount: number;
  state: CapacityState;
}

export interface SprintCapacitySummary {
  sprintId: ID;
  members: MemberCapacity[];
  totalCapacity: number;
  totalUsed: number;
  totalRemaining: number;
  /** All tickets placed in the sprint, planned or not. */
  ticketCount: number;
  /** Sprint tickets that have no assignee. */
  unassigned: { count: number; points: number };
  /** Sprint tickets that have no estimate. */
  unestimated: { count: number };
}

export interface CapacityConflict {
  memberId: ID;
  memberName: string;
  sprintId: ID;
  sprintName: string;
  capacity: number;
  /** Points already allocated to the member in that sprint, excluding the ticket being changed. */
  allocatedElsewhere: number;
  remaining: number;
  requested: number;
  overBy: number;
}

export const LOW_CAPACITY_THRESHOLD = 2;

/** Round to 2 decimals so sums of free-text estimates never show float noise. */
export function roundPoints(n: number): number {
  return Math.round(n * 100) / 100;
}

export function clampCapacity(n: number): number {
  if (!Number.isFinite(n)) return MAX_MEMBER_CAPACITY;
  return Math.min(MAX_MEMBER_CAPACITY, Math.max(0, roundPoints(n)));
}

/** Story points are free text: any number greater than 0 and at most 10, or unestimated. */
export function isValidPoints(points: number | null): boolean {
  if (points === null) return true;
  return Number.isFinite(points) && points > 0 && points <= MAX_MEMBER_CAPACITY && roundPoints(points) === points;
}

export function isValidCapacity(capacity: number): boolean {
  return Number.isFinite(capacity) && capacity >= 0 && capacity <= MAX_MEMBER_CAPACITY;
}

export type ParsedPoints = { ok: true; value: number | null } | { ok: false; error: string };

/** Parse what someone typed into a story-point field. Empty means unestimated. */
export function parsePoints(text: string): ParsedPoints {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '' || trimmed === '-' || trimmed === '–') return { ok: true, value: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { ok: false, error: `“${text.trim()}” isn’t a number. Enter story points like 1, 2.5 or 8.` };
  if (n <= 0) return { ok: false, error: 'Story points must be greater than 0. Clear the field to leave it unestimated.' };
  if (n > MAX_MEMBER_CAPACITY) return { ok: false, error: `Story points can’t exceed ${MAX_MEMBER_CAPACITY} — one person’s whole sprint. Split the task.` };
  return { ok: true, value: roundPoints(n) };
}

/** Capacity of one member for one sprint — the sprint override, else the member default, never above 10. */
export function memberCapacityFor(sprint: Sprint, member: Member): number {
  const override = sprint.capacities[member.id];
  return clampCapacity(override ?? member.defaultCapacity);
}

/** A ticket consumes capacity in a sprint only if it is in that sprint, assigned, and estimated. */
export function consumesCapacity(ticket: Ticket, sprintId: ID): boolean {
  return ticket.sprintId === sprintId && ticket.assigneeId !== null && ticket.points !== null && ticket.points > 0;
}

/** Whether a sprint ticket is missing an assignee or an estimate. */
export function isIncompletePlanningItem(ticket: Ticket): boolean {
  return ticket.sprintId !== null && (ticket.assigneeId === null || ticket.points === null);
}

export function memberAllocation(tickets: Ticket[], sprintId: ID, memberId: ID, excludeTicketId?: ID): number {
  let total = 0;
  for (const t of tickets) {
    if (t.id === excludeTicketId) continue;
    if (t.assigneeId === memberId && consumesCapacity(t, sprintId)) total += t.points ?? 0;
  }
  return roundPoints(total);
}

export function capacityState(capacity: number, used: number): CapacityState {
  const remaining = capacity - used;
  if (capacity === 0 && used === 0) return 'empty';
  if (remaining < 0) return 'over';
  if (remaining === 0) return 'full';
  if (remaining <= LOW_CAPACITY_THRESHOLD) return 'low';
  return 'ok';
}

export function summarizeSprintCapacity(
  data: Pick<AppData, 'members' | 'tickets'>,
  sprint: Sprint,
): SprintCapacitySummary {
  const sprintTickets = data.tickets.filter((t) => t.sprintId === sprint.id);
  const members = [...data.members]
    .sort((a, b) => a.order - b.order)
    .map<MemberCapacity>((member) => {
      const capacity = memberCapacityFor(sprint, member);
      const own = sprintTickets.filter((t) => t.assigneeId === member.id);
      const used = memberAllocation(sprintTickets, sprint.id, member.id);
      const defaultCapacity = clampCapacity(member.defaultCapacity);
      return {
        member,
        capacity,
        defaultCapacity,
        isReduced: capacity < defaultCapacity,
        used,
        remaining: roundPoints(capacity - used),
        ticketCount: own.length,
        state: capacityState(capacity, used),
      };
    });

  const totalCapacity = roundPoints(members.reduce((s, m) => s + m.capacity, 0));
  const totalUsed = roundPoints(members.reduce((s, m) => s + m.used, 0));
  const unassignedTickets = sprintTickets.filter((t) => t.assigneeId === null);

  return {
    sprintId: sprint.id,
    members,
    totalCapacity,
    totalUsed,
    totalRemaining: roundPoints(totalCapacity - totalUsed),
    ticketCount: sprintTickets.length,
    unassigned: {
      count: unassignedTickets.length,
      points: roundPoints(unassignedTickets.reduce((s, t) => s + (t.points ?? 0), 0)),
    },
    unestimated: { count: sprintTickets.filter((t) => t.points === null).length },
  };
}

/**
 * Check whether `proposed` (the ticket state after an edit) would push its
 * assignee over capacity in its sprint. Returns null when the change is safe.
 *
 * Only open sprints (active or planned) are checked; closed sprints are history.
 */
export function findCapacityConflict(data: Pick<AppData, 'members' | 'tickets' | 'sprints'>, proposed: Ticket): CapacityConflict | null {
  if (proposed.sprintId === null || proposed.assigneeId === null || proposed.points === null) return null;
  const sprint = data.sprints.find((s) => s.id === proposed.sprintId);
  if (!sprint || sprint.status === 'closed') return null;
  const member = data.members.find((m) => m.id === proposed.assigneeId);
  if (!member) return null;

  const capacity = memberCapacityFor(sprint, member);
  const allocatedElsewhere = memberAllocation(data.tickets, sprint.id, member.id, proposed.id);
  const after = roundPoints(allocatedElsewhere + proposed.points);
  if (after <= capacity) return null;

  // An unchanged, already-over allocation (e.g. after an import) should not block unrelated edits.
  const existing = data.tickets.find((t) => t.id === proposed.id);
  if (
    existing &&
    existing.sprintId === proposed.sprintId &&
    existing.assigneeId === proposed.assigneeId &&
    existing.points !== null &&
    proposed.points <= existing.points
  ) {
    return null;
  }

  return {
    memberId: member.id,
    memberName: member.name,
    sprintId: sprint.id,
    sprintName: sprint.name,
    capacity,
    allocatedElsewhere,
    remaining: roundPoints(Math.max(0, capacity - allocatedElsewhere)),
    requested: proposed.points,
    overBy: roundPoints(after - capacity),
  };
}

export function describeConflict(c: CapacityConflict): string {
  const pts = (n: number) => `${formatPoints(n)} SP`;
  return `${c.memberName} has ${pts(c.remaining)} remaining in ${c.sprintName} (${formatPoints(c.allocatedElsewhere)} of ${formatPoints(
    c.capacity,
  )} allocated). This task needs ${pts(c.requested)}, which would exceed capacity by ${pts(c.overBy)}.`;
}

/** Members whose existing allocation exceeds the proposed capacities for a sprint. */
export function findCapacityReductionConflicts(
  data: Pick<AppData, 'members' | 'tickets'>,
  sprint: Sprint,
  capacities: Record<ID, number>,
): { member: Member; capacity: number; allocated: number }[] {
  if (sprint.status === 'closed') return [];
  const conflicts: { member: Member; capacity: number; allocated: number }[] = [];
  for (const member of data.members) {
    const capacity = clampCapacity(capacities[member.id] ?? member.defaultCapacity);
    const allocated = memberAllocation(data.tickets, sprint.id, member.id);
    if (allocated > capacity) conflicts.push({ member, capacity, allocated });
  }
  return conflicts;
}

export function formatPoints(n: number): string {
  return String(roundPoints(n));
}
