import { consumesCapacity, roundPoints } from '@/domain/capacity';
import type { AppData, ID, Project, Section, Ticket } from '@/domain/types';
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
