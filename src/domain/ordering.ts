import type { AppData, Ticket } from './types';

/** Comparator ordering tickets by planning priority: section, then project, then ticket order. */
export function boardOrder(data: Pick<AppData, 'sections' | 'projects'>): (a: Ticket, b: Ticket) => number {
  const sectionOrder = new Map(data.sections.map((s) => [s.id, s.order]));
  const rank = new Map(data.projects.map((p) => [p.id, [sectionOrder.get(p.sectionId) ?? 0, p.order] as const]));
  return (a, b) => {
    const [as, ap] = rank.get(a.projectId) ?? [0, 0];
    const [bs, bp] = rank.get(b.projectId) ?? [0, 0];
    return as - bs || ap - bp || a.order - b.order;
  };
}
