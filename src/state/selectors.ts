import { consumesCapacity, formatPoints, memberCapacityFor, roundPoints } from '@/domain/capacity';
import type { AppData, ID, Member, Project, Section, Sprint, Ticket } from '@/domain/types';
import type { Filters } from './react';

export function sortedSections(data: AppData): Section[] {
  return [...data.sections].sort((a, b) => a.order - b.order);
}

export function sortedMembers(data: AppData) {
  return [...data.members].sort((a, b) => a.order - b.order);
}

export function groupProjects(data: AppData): Map<ID, Project[]> {
  const map = new Map<ID, Project[]>();
  for (const p of data.projects) {
    const list = map.get(p.sectionId) ?? [];
    list.push(p);
    map.set(p.sectionId, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.order - b.order);
  return map;
}

export function groupTickets(data: AppData): Map<ID, Ticket[]> {
  const map = new Map<ID, Ticket[]>();
  for (const t of data.tickets) {
    const list = map.get(t.projectId) ?? [];
    list.push(t);
    map.set(t.projectId, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.order - b.order);
  return map;
}

/** Points allocated (assigned + estimated) to a sprint from a list of tickets. */
export function sprintPoints(tickets: Ticket[], sprintId: ID | null): number {
  if (!sprintId) return 0;
  return roundPoints(tickets.filter((t) => consumesCapacity(t, sprintId)).reduce((s, t) => s + (t.points ?? 0), 0));
}

export function hasActiveFilters(filters: Filters, search: string): boolean {
  return search.trim() !== '' || filters.scope !== 'all' || filters.assignee !== 'all' || filters.gap !== 'none';
}

/** Tasks in closed sprints are history: they live in Sprint History, not on the board. */
export function isOnBoard(t: Ticket, closedSprintIds: Set<ID>): boolean {
  return t.sprintId === null || !closedSprintIds.has(t.sprintId);
}

export function matchesSearch(text: string, query: string): boolean {
  return text.toLowerCase().includes(query);
}

export function ticketMatches(t: Ticket, filters: Filters, query: string, planningSprintId: ID | null, projectMatched: boolean): boolean {
  if (filters.scope === 'sprint' && (!planningSprintId || t.sprintId !== planningSprintId)) return false;
  if (filters.scope === 'backlog' && t.sprintId !== null) return false;
  if (filters.assignee === 'unassigned' && t.assigneeId !== null) return false;
  if (filters.assignee !== 'all' && filters.assignee !== 'unassigned' && t.assigneeId !== filters.assignee) return false;
  if (filters.gap === 'unassigned' && (t.assigneeId !== null || t.sprintId !== planningSprintId)) return false;
  if (filters.gap === 'unestimated' && (t.points !== null || t.sprintId !== planningSprintId)) return false;
  if (query && !projectMatched) {
    const hay = `${t.key} ${t.title} ${t.description}`;
    if (!matchesSearch(hay, query)) return false;
  }
  return true;
}

/**
 * Re-order the full list after a drag within a filtered (visible) subset:
 * visible items are permuted inside the slots they already occupy.
 */
export function mergeVisibleOrder(fullIds: ID[], visibleReordered: ID[]): ID[] {
  const visible = new Set(visibleReordered);
  const queue = [...visibleReordered];
  return fullIds.map((id) => (visible.has(id) ? queue.shift()! : id));
}

export { boardOrder } from '@/domain/ordering';

// ---------------------------------------------------------------- cut line ledger

/** Only active projects are planned top-down. On hold, completed and archived projects are skipped. */
export function isRankedProject(p: Project): boolean {
  return p.lifecycle === 'active';
}

export type LedgerTaskState =
  /** Above the line with an assignee and SP: counts toward capacity. */
  | 'counted'
  /** Above the line but missing an assignee or SP: flagged and not counted. */
  | 'incomplete'
  /** At or after the cut line. */
  | 'below'
  /** Planned in a different open sprint, so not available for this one. */
  | 'elsewhere'
  /** Its project is not active (on hold, completed or archived). */
  | 'excluded';

export interface LedgerTask {
  ticket: Ticket;
  /** 1-based position among ranked tasks, or null when the task isn't ranked. */
  rank: number | null;
  state: LedgerTaskState;
  /** Running total of counted SP up to and including this task. Counted tasks only. */
  cumulative: number | null;
  missingOwner: boolean;
  missingPoints: boolean;
}

export interface LedgerProject {
  project: Project;
  excluded: boolean;
  tasks: LedgerTask[];
  abovePoints: number;
  belowPoints: number;
}

export interface LedgerSection {
  section: Section;
  projects: LedgerProject[];
  /** Every project in the section is on hold, completed or archived. */
  notThisSprint: boolean;
  abovePoints: number;
  belowPoints: number;
}

export type CutReason =
  | { kind: 'team'; needed: number; remaining: number }
  | { kind: 'member'; memberId: ID; memberName: string; needed: number; remaining: number };

export interface LedgerMember {
  member: Member;
  capacity: number;
  /** SP counted above the line for this person. */
  used: number;
  remaining: number;
}

export interface CutLineLedger {
  sprintId: ID;
  sections: LedgerSection[];
  /** The first task that doesn't fit, or null when everything ranked fits. */
  cut: { ticketId: ID; reason: CutReason } | null;
  teamCapacity: number;
  abovePoints: number;
  belowPoints: number;
  belowCount: number;
  /** Above-line tasks missing an assignee and/or SP. */
  incomplete: { count: number; noOwner: number; noPoints: number };
  members: LedgerMember[];
  /** Above-line counted tasks not yet in the sprint, in rank order. */
  fillIds: ID[];
}

/**
 * Walk tasks top-down (section, project, task order) and find where the sprint's
 * capacity runs out. This is guidance only: it never changes sprint membership.
 *
 * Ranked tasks are backlog tasks and tasks already in `sprint`, in active projects.
 * A ranked task with an assignee and SP is counted until it would push the team or
 * its assignee past capacity; that task is the cut, and everything after it is below
 * the line. Tasks missing an assignee or SP never trigger the cut and are flagged.
 */
export function cutLineLedger(data: AppData, sprint: Sprint): CutLineLedger {
  const closedIds = new Set(data.sprints.filter((s) => s.status === 'closed').map((s) => s.id));
  const projectsBySection = groupProjects(data);
  const ticketsByProject = groupTickets(data);
  const members = sortedMembers(data);
  const capacity = new Map(members.map((m) => [m.id, memberCapacityFor(sprint, m)]));
  const used = new Map(members.map((m) => [m.id, 0]));
  const teamCapacity = roundPoints([...capacity.values()].reduce((s, c) => s + c, 0));

  let cum = 0;
  let rank = 0;
  let cut: CutLineLedger['cut'] = null;
  let belowPoints = 0;
  let belowCount = 0;
  const incomplete = { count: 0, noOwner: 0, noPoints: 0 };
  const fillIds: ID[] = [];

  const sections = sortedSections(data).map<LedgerSection>((section) => {
    const projects = (projectsBySection.get(section.id) ?? []).map<LedgerProject>((project) => {
      const excluded = !isRankedProject(project);
      const tasks = (ticketsByProject.get(project.id) ?? [])
        .filter((t) => isOnBoard(t, closedIds))
        .map<LedgerTask>((ticket) => {
          const missingOwner = ticket.assigneeId === null || !capacity.has(ticket.assigneeId);
          const missingPoints = ticket.points === null;
          const base = { ticket, missingOwner, missingPoints, rank: null, cumulative: null };
          if (excluded) return { ...base, state: 'excluded' };
          if (ticket.sprintId !== null && ticket.sprintId !== sprint.id) return { ...base, state: 'elsewhere' };

          rank += 1;
          const ranked = { ...base, rank };
          const complete = !missingOwner && !missingPoints;
          if (!cut && complete) {
            const who = ticket.assigneeId!;
            const pts = ticket.points!;
            const memberLeft = roundPoints(capacity.get(who)! - used.get(who)!);
            const teamLeft = roundPoints(teamCapacity - cum);
            if (pts > teamLeft) cut = { ticketId: ticket.id, reason: { kind: 'team', needed: pts, remaining: teamLeft } };
            else if (pts > memberLeft) {
              const name = members.find((m) => m.id === who)!.name;
              cut = { ticketId: ticket.id, reason: { kind: 'member', memberId: who, memberName: name, needed: pts, remaining: memberLeft } };
            }
          }
          if (cut) {
            belowCount += 1;
            belowPoints = roundPoints(belowPoints + (ticket.points ?? 0));
            return { ...ranked, state: 'below' };
          }
          if (!complete) {
            incomplete.count += 1;
            if (missingOwner) incomplete.noOwner += 1;
            if (missingPoints) incomplete.noPoints += 1;
            return { ...ranked, state: 'incomplete' };
          }
          used.set(ticket.assigneeId!, roundPoints(used.get(ticket.assigneeId!)! + ticket.points!));
          cum = roundPoints(cum + ticket.points!);
          if (ticket.sprintId !== sprint.id) fillIds.push(ticket.id);
          return { ...ranked, state: 'counted', cumulative: cum };
        });
      return {
        project,
        excluded,
        tasks,
        abovePoints: sumPoints(tasks, 'counted'),
        belowPoints: sumPoints(tasks, 'below'),
      };
    });
    return {
      section,
      projects,
      notThisSprint: projects.length > 0 && projects.every((p) => p.excluded),
      abovePoints: roundPoints(projects.reduce((s, p) => s + p.abovePoints, 0)),
      belowPoints: roundPoints(projects.reduce((s, p) => s + p.belowPoints, 0)),
    };
  });

  return {
    sprintId: sprint.id,
    sections,
    cut,
    teamCapacity,
    abovePoints: cum,
    belowPoints,
    belowCount,
    incomplete,
    members: members.map((member) => {
      const cap = capacity.get(member.id)!;
      const u = used.get(member.id)!;
      return { member, capacity: cap, used: u, remaining: roundPoints(cap - u) };
    }),
    fillIds,
  };
}

function sumPoints(tasks: LedgerTask[], state: LedgerTaskState): number {
  return roundPoints(tasks.filter((t) => t.state === state).reduce((s, t) => s + (t.ticket.points ?? 0), 0));
}

export function describeCutReason(reason: CutReason): string {
  const need = `Next task needs ${formatPoints(reason.needed)} SP`;
  return reason.kind === 'team'
    ? `${need}; the team has ${formatPoints(reason.remaining)} left.`
    : `${need} from ${reason.memberName}, who has ${formatPoints(reason.remaining)} left.`;
}
