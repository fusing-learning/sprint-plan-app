import { applyChanges } from '@/data/applyChanges';
import type { PlanningRepository } from '@/data/repository';
import { createDemoData, createEmptyWorkspace, makeStarterSprint } from '@/data/seed';
import { createBackup, type BackupFile } from '@/domain/backup';
import {
  clampCapacity,
  describeConflict,
  findCapacityConflict,
  findCapacityReductionConflicts,
  formatPoints,
  isValidCapacity,
  isValidPoints,
  type CapacityConflict,
} from '@/domain/capacity';
import { closeSprint, SprintClosureError, type CloseDecision } from '@/domain/sprints';
import {
  SCHEMA_VERSION,
  type AppData,
  type ChangeSet,
  type ID,
  type Member,
  type Project,
  type Section,
  type SectionColor,
  type Sprint,
  type Ticket,
} from '@/domain/types';
import { newId } from '@/lib/utils';

export type OpResult<T = undefined> =
  /** `warning` reports something allowed but worth knowing, such as going over capacity. */
  | { ok: true; value: T; message?: string; warning?: string }
  | { ok: false; error: string; conflicts?: CapacityConflict[] };

const ok = <T>(value: T, message?: string): OpResult<T> => ({ ok: true, value, message });
const okWithWarning = <T>(value: T, warning?: string): OpResult<T> => ({ ok: true, value, warning });
const fail = (error: string, conflicts?: CapacityConflict[]): OpResult<never> => ({ ok: false, error, conflicts });

export interface StoreState {
  status: 'loading' | 'ready' | 'error';
  data: AppData;
  error?: string;
  /** Number of change sets not yet confirmed by the repository. */
  pendingWrites: number;
  lastSavedAt: number | null;
}

const EMPTY: AppData = {
  meta: { id: 'app', schemaVersion: SCHEMA_VERSION, initialized: false, nextTicketNumber: 1, ticketKeyPrefix: 'SF' },
  members: [],
  sections: [],
  projects: [],
  tickets: [],
  sprints: [],
};

export type TicketInput = Partial<Omit<Ticket, 'id' | 'key' | 'createdAt' | 'updatedAt'>> & { projectId: ID; title: string };
export type TicketPatch = Partial<Omit<Ticket, 'id' | 'key' | 'createdAt' | 'updatedAt'>>;
export type ProjectInput = Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt' | 'order'>> & { name: string; sectionId: ID };
export type SprintInput = Pick<Sprint, 'name' | 'startDate' | 'endDate'> & Partial<Pick<Sprint, 'goal' | 'capacities'>>;

/**
 * Application service + state container.
 *
 * - Every operation validates business rules (sprint rules, valid fields) against
 *   the current in-memory data and returns an OpResult. Nothing is silently ignored.
 *   Going over a person's capacity is allowed and reported as a warning.
 * - Accepted changes update in-memory state immediately (instant UI feedback),
 *   then are persisted through the repository in a serialized write queue.
 * - The store knows nothing about React or IndexedDB.
 */
export class PlanningStore {
  private state: StoreState = { status: 'loading', data: EMPTY, pendingWrites: 0, lastSavedAt: null };
  private listeners = new Set<() => void>();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly repo: PlanningRepository,
    private readonly clock: () => Date = () => new Date(),
    private readonly onPersistError: (error: unknown) => void = (e) => console.error('SprintFlow: failed to save', e),
  ) {}

  // ---------------------------------------------------------------- plumbing

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = () => this.state;

  get data(): AppData {
    return this.state.data;
  }

  private setState(patch: Partial<StoreState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private now() {
    return this.clock().toISOString();
  }

  async init(): Promise<void> {
    try {
      let data = await this.repo.load();
      if (!data) {
        // First launch: a clean workspace with one empty active sprint. Demo data is opt-in.
        data = createEmptyWorkspace(this.clock());
        await this.repo.replaceAll(data);
      }
      this.setState({ status: 'ready', data, error: undefined });
    } catch (e) {
      this.setState({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Resolves once all queued writes have been persisted. */
  flush(): Promise<void> {
    return this.queue;
  }

  private enqueue(write: () => Promise<void>) {
    this.setState({ pendingWrites: this.state.pendingWrites + 1 });
    this.queue = this.queue
      .then(write)
      .then(() => {
        this.setState({ pendingWrites: this.state.pendingWrites - 1, lastSavedAt: Date.now() });
      })
      .catch(async (e) => {
        this.onPersistError(e);
        // Re-sync from the source of truth so the UI never shows unsaved state as saved.
        const fresh = await this.repo.load().catch(() => null);
        this.setState({ pendingWrites: this.state.pendingWrites - 1, ...(fresh ? { data: fresh } : {}) });
      });
  }

  private commit(changes: ChangeSet) {
    this.setState({ data: applyChanges(this.state.data, changes) });
    this.enqueue(() => this.repo.apply(changes));
  }

  private replace(data: AppData) {
    this.setState({ data });
    this.enqueue(() => this.repo.replaceAll(data));
  }

  // ---------------------------------------------------------------- lookups

  private member(id: ID) {
    return this.data.members.find((m) => m.id === id);
  }
  private section(id: ID) {
    return this.data.sections.find((s) => s.id === id);
  }
  private project(id: ID) {
    return this.data.projects.find((p) => p.id === id);
  }
  private ticket(id: ID) {
    return this.data.tickets.find((t) => t.id === id);
  }
  private sprint(id: ID) {
    return this.data.sprints.find((s) => s.id === id);
  }
  get activeSprint(): Sprint | undefined {
    return this.data.sprints.find((s) => s.status === 'active');
  }

  // ---------------------------------------------------------------- members

  addMember(name: string, role = 'Engineer'): OpResult<Member> {
    if (!name.trim()) return fail('Name is required.');
    const ts = this.now();
    const order = Math.max(-1, ...this.data.members.map((m) => m.order)) + 1;
    const member: Member = { id: newId('mem'), name: name.trim(), role: role.trim(), defaultCapacity: 10, order, createdAt: ts, updatedAt: ts };
    this.commit({ put: { members: [member] } });
    return ok(member);
  }

  updateMember(id: ID, patch: Partial<Pick<Member, 'name' | 'role' | 'defaultCapacity'>>): OpResult<Member> {
    const existing = this.member(id);
    if (!existing) return fail('Team member not found.');
    if (patch.name !== undefined && !patch.name.trim()) return fail('Name is required.');
    if (patch.defaultCapacity !== undefined && !isValidCapacity(patch.defaultCapacity)) {
      return fail('Capacity must be between 0 and 10 points, in 0.5 steps.');
    }
    const next: Member = {
      ...existing,
      ...patch,
      name: (patch.name ?? existing.name).trim(),
      role: (patch.role ?? existing.role).trim(),
      updatedAt: this.now(),
    };
    // A lower default is allowed even if it leaves this person over capacity in open sprints that use it.
    const warnings: string[] = [];
    if (patch.defaultCapacity !== undefined) {
      const members = this.data.members.map((m) => (m.id === id ? next : m));
      for (const sprint of this.data.sprints) {
        if (sprint.status === 'closed' || sprint.capacities[id] !== undefined) continue;
        const over = findCapacityReductionConflicts({ members, tickets: this.data.tickets }, sprint, sprint.capacities).filter((x) => x.member.id === id);
        const warning = overAllocatedWarning(over, sprint.name);
        if (warning) warnings.push(warning);
      }
    }
    this.commit({ put: { members: [next] } });
    return okWithWarning(next, warnings.join(' ') || undefined);
  }

  removeMember(id: ID): OpResult<{ unassigned: number }> {
    const existing = this.member(id);
    if (!existing) return fail('Team member not found.');
    const ts = this.now();
    const tickets = this.data.tickets.filter((t) => t.assigneeId === id).map((t) => ({ ...t, assigneeId: null, updatedAt: ts }));
    const sprints = this.data.sprints
      .filter((s) => s.status !== 'closed' && s.capacities[id] !== undefined)
      .map((s) => {
        const capacities = { ...s.capacities };
        delete capacities[id];
        return { ...s, capacities, updatedAt: ts };
      });
    this.commit({ put: { tickets, sprints }, delete: { members: [id] } });
    return ok({ unassigned: tickets.length });
  }

  // ---------------------------------------------------------------- sections

  createSection(input: { name: string; description?: string; color?: SectionColor }): OpResult<Section> {
    if (!input.name.trim()) return fail('Section name is required.');
    const ts = this.now();
    const order = Math.max(-1, ...this.data.sections.map((s) => s.order)) + 1;
    const section: Section = {
      id: newId('sec'),
      name: input.name.trim(),
      description: input.description?.trim() ?? '',
      color: input.color ?? 'slate',
      order,
      createdAt: ts,
      updatedAt: ts,
    };
    this.commit({ put: { sections: [section] } });
    return ok(section);
  }

  updateSection(id: ID, patch: Partial<Pick<Section, 'name' | 'description' | 'color'>>): OpResult<Section> {
    const existing = this.section(id);
    if (!existing) return fail('Section not found.');
    if (patch.name !== undefined && !patch.name.trim()) return fail('Section name is required.');
    const next = { ...existing, ...patch, name: (patch.name ?? existing.name).trim(), updatedAt: this.now() };
    this.commit({ put: { sections: [next] } });
    return ok(next);
  }

  reorderSections(orderedIds: ID[]): OpResult {
    const ts = this.now();
    const sections = orderedIds
      .map((id, order) => {
        const s = this.section(id);
        return s && s.order !== order ? { ...s, order, updatedAt: ts } : null;
      })
      .filter((s): s is Section => s !== null);
    if (sections.length) this.commit({ put: { sections } });
    return ok(undefined);
  }

  /** Delete a section. If it contains projects, `moveProjectsTo` must name another section. */
  deleteSection(id: ID, moveProjectsTo?: ID): OpResult<{ moved: number }> {
    const existing = this.section(id);
    if (!existing) return fail('Section not found.');
    const contained = this.data.projects.filter((p) => p.sectionId === id).sort((a, b) => a.order - b.order);
    if (contained.length) {
      if (!moveProjectsTo || moveProjectsTo === id || !this.section(moveProjectsTo)) {
        return fail(`"${existing.name}" contains ${contained.length} project(s). Move them to another section first.`);
      }
    }
    const ts = this.now();
    const base = Math.max(-1, ...this.data.projects.filter((p) => p.sectionId === moveProjectsTo).map((p) => p.order)) + 1;
    const projects = contained.map((p, i) => ({ ...p, sectionId: moveProjectsTo!, order: base + i, updatedAt: ts }));
    const remaining = this.data.sections.filter((s) => s.id !== id).sort((a, b) => a.order - b.order);
    const sections = remaining.map((s, order) => (s.order === order ? s : { ...s, order, updatedAt: ts }));
    this.commit({ put: { projects, sections }, delete: { sections: [id] } });
    return ok({ moved: projects.length });
  }

  // ---------------------------------------------------------------- projects

  createProject(input: ProjectInput): OpResult<Project> {
    if (!input.name.trim()) return fail('Project name is required.');
    if (!this.section(input.sectionId)) return fail('Choose a priority section.');
    const ts = this.now();
    const order = Math.max(-1, ...this.data.projects.filter((p) => p.sectionId === input.sectionId).map((p) => p.order)) + 1;
    const project: Project = {
      id: newId('prj'),
      name: input.name.trim(),
      description: input.description?.trim() ?? '',
      sectionId: input.sectionId,
      lifecycle: input.lifecycle ?? 'active',
      targetDate: input.targetDate ?? null,
      owner: input.owner?.trim() ?? '',
      external: input.external ?? {},
      order,
      createdAt: ts,
      updatedAt: ts,
    };
    this.commit({ put: { projects: [project] } });
    return ok(project);
  }

  updateProject(id: ID, patch: Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt'>>): OpResult<Project> {
    const existing = this.project(id);
    if (!existing) return fail('Project not found.');
    if (patch.name !== undefined && !patch.name.trim()) return fail('Project name is required.');
    if (patch.sectionId !== undefined && !this.section(patch.sectionId)) return fail('Section not found.');
    const next: Project = { ...existing, ...patch, updatedAt: this.now() };
    if (patch.name !== undefined) next.name = patch.name.trim();
    if (patch.sectionId !== undefined && patch.sectionId !== existing.sectionId && patch.order === undefined) {
      next.order = Math.max(-1, ...this.data.projects.filter((p) => p.sectionId === patch.sectionId).map((p) => p.order)) + 1;
    }
    this.commit({ put: { projects: [next] } });
    return ok(next);
  }

  reorderProjects(sectionId: ID, orderedIds: ID[]): OpResult {
    const ts = this.now();
    const projects = orderedIds
      .map((id, order) => {
        const p = this.project(id);
        return p && (p.order !== order || p.sectionId !== sectionId) ? { ...p, sectionId, order, updatedAt: ts } : null;
      })
      .filter((p): p is Project => p !== null);
    if (projects.length) this.commit({ put: { projects } });
    return ok(undefined);
  }

  /** Deletes the project and its tickets. Closed sprint snapshots are unaffected. */
  deleteProject(id: ID): OpResult<{ ticketsDeleted: number }> {
    if (!this.project(id)) return fail('Project not found.');
    const ticketIds = this.data.tickets.filter((t) => t.projectId === id).map((t) => t.id);
    this.commit({ delete: { projects: [id], tickets: ticketIds } });
    return ok({ ticketsDeleted: ticketIds.length });
  }

  // ---------------------------------------------------------------- tickets

  private validateTicket(proposed: Ticket, existing?: Ticket): OpResult<Ticket> {
    if (!proposed.title.trim()) return fail('Ticket title is required.');
    if (!this.project(proposed.projectId)) return fail('Parent project not found.');
    if (!isValidPoints(proposed.points)) return fail('Story points must be a number greater than 0 and at most 10, or left empty.');
    if (proposed.assigneeId !== null && !this.member(proposed.assigneeId)) return fail('Assignee not found.');
    if (proposed.sprintId !== null) {
      const sprint = this.sprint(proposed.sprintId);
      if (!sprint) return fail('Sprint not found.');
      if (sprint.status === 'closed' && existing?.sprintId !== proposed.sprintId) {
        return fail(`${sprint.name} is closed. Closed sprints are read-only.`);
      }
    }
    const conflict = findCapacityConflict(this.data, proposed);
    return okWithWarning(proposed, conflict ? overCapacityWarning(conflict) : undefined);
  }

  createTicket(input: TicketInput): OpResult<Ticket> {
    const ts = this.now();
    const meta = this.data.meta;
    const siblings = this.data.tickets.filter((t) => t.projectId === input.projectId);
    const ticket: Ticket = {
      id: newId('tkt'),
      key: `${meta.ticketKeyPrefix}-${meta.nextTicketNumber}`,
      title: input.title.trim(),
      description: input.description ?? '',
      projectId: input.projectId,
      assigneeId: input.assigneeId ?? null,
      points: input.points ?? null,
      sprintId: input.sprintId ?? null,
      order: input.order ?? Math.max(-1, ...siblings.map((t) => t.order)) + 1,
      external: input.external ?? {},
      createdAt: ts,
      updatedAt: ts,
    };
    const valid = this.validateTicket(ticket);
    if (!valid.ok) return valid;
    this.commit({ put: { tickets: [ticket], meta: { ...meta, nextTicketNumber: meta.nextTicketNumber + 1 } } });
    return valid;
  }

  updateTicket(id: ID, patch: TicketPatch): OpResult<Ticket> {
    const existing = this.ticket(id);
    if (!existing) return fail('Ticket not found.');
    const next: Ticket = { ...existing, ...patch, updatedAt: this.now() };
    if (patch.title !== undefined) next.title = patch.title.trim();
    if (patch.projectId !== undefined && patch.projectId !== existing.projectId && patch.order === undefined) {
      next.order = Math.max(-1, ...this.data.tickets.filter((t) => t.projectId === patch.projectId).map((t) => t.order)) + 1;
    }
    const valid = this.validateTicket(next, existing);
    if (!valid.ok) return valid;
    this.commit({ put: { tickets: [next] } });
    return valid;
  }

  /** Check a proposed edit without applying it (used for live previews in forms). */
  previewTicket(id: ID | null, draft: Ticket): CapacityConflict | null {
    const proposed = id ? { ...draft, id } : draft;
    return findCapacityConflict(this.data, proposed);
  }

  /** Duplicate right after the original, in the same open sprint (closed sprints are history, so those go to the backlog). */
  duplicateTicket(id: ID): OpResult<Ticket> {
    const existing = this.ticket(id);
    if (!existing) return fail('Ticket not found.');
    const ts = this.now();
    const shifted = this.data.tickets
      .filter((t) => t.projectId === existing.projectId && t.order > existing.order)
      .map((t) => ({ ...t, order: t.order + 1 }));
    const meta = this.data.meta;
    const copy: Ticket = {
      ...existing,
      id: newId('tkt'),
      key: `${meta.ticketKeyPrefix}-${meta.nextTicketNumber}`,
      title: `${existing.title} (copy)`,
      sprintId: this.sprint(existing.sprintId ?? '')?.status === 'closed' ? null : existing.sprintId,
      order: existing.order + 1,
      external: {},
      createdAt: ts,
      updatedAt: ts,
    };
    const conflict = findCapacityConflict(this.data, copy);
    this.commit({ put: { tickets: [...shifted, copy], meta: { ...meta, nextTicketNumber: meta.nextTicketNumber + 1 } } });
    return { ok: true, value: copy, message: copy.sprintId ? undefined : 'Duplicate added to the backlog.', warning: conflict ? overCapacityWarning(conflict) : undefined };
  }

  deleteTicket(id: ID): OpResult {
    if (!this.ticket(id)) return fail('Ticket not found.');
    this.commit({ delete: { tickets: [id] } });
    return ok(undefined);
  }

  reorderTickets(projectId: ID, orderedIds: ID[]): OpResult {
    const tickets = orderedIds
      .map((id, order) => {
        const t = this.ticket(id);
        return t && t.projectId === projectId && t.order !== order ? { ...t, order } : null;
      })
      .filter((t): t is Ticket => t !== null);
    if (tickets.length) this.commit({ put: { tickets } });
    return ok(undefined);
  }

  // ---------------------------------------------------------------- sprints

  private validateSprintFields(input: SprintInput): string | null {
    if (!input.name.trim()) return 'Sprint name is required.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate)) return 'Start and end dates are required.';
    if (input.endDate < input.startDate) return 'End date must be on or after the start date.';
    for (const [memberId, cap] of Object.entries(input.capacities ?? {})) {
      if (!isValidCapacity(cap)) {
        const name = this.member(memberId)?.name ?? 'A member';
        return `${name}'s capacity must be between 0 and 10 points.`;
      }
    }
    return null;
  }

  createSprint(input: SprintInput): OpResult<Sprint> {
    const error = this.validateSprintFields(input);
    if (error) return fail(error);
    const ts = this.now();
    const sprint: Sprint = {
      id: newId('spr'),
      name: input.name.trim(),
      goal: input.goal?.trim() ?? '',
      startDate: input.startDate,
      endDate: input.endDate,
      status: 'planned',
      capacities: normalizeCapacities(input.capacities ?? {}, this.data.members),
      snapshot: null,
      createdAt: ts,
      updatedAt: ts,
    };
    this.commit({ put: { sprints: [sprint] } });
    return ok(sprint);
  }

  updateSprint(id: ID, patch: Partial<SprintInput>): OpResult<Sprint> {
    const existing = this.sprint(id);
    if (!existing) return fail('Sprint not found.');
    if (existing.status === 'closed') return fail('Closed sprints are read-only.');
    const merged = {
      name: patch.name ?? existing.name,
      startDate: patch.startDate ?? existing.startDate,
      endDate: patch.endDate ?? existing.endDate,
      goal: patch.goal ?? existing.goal,
      capacities: patch.capacities ?? existing.capacities,
    };
    const error = this.validateSprintFields(merged);
    if (error) return fail(error);
    const capacities = normalizeCapacities(merged.capacities, this.data.members);
    // Lowering capacity below what's allocated is allowed; it leaves those people over capacity.
    const reductions = findCapacityReductionConflicts(this.data, existing, capacities);
    const next: Sprint = { ...existing, ...merged, name: merged.name.trim(), goal: merged.goal.trim(), capacities, updatedAt: this.now() };
    this.commit({ put: { sprints: [next] } });
    return okWithWarning(next, overAllocatedWarning(reductions, next.name));
  }

  activateSprint(id: ID): OpResult<Sprint> {
    const sprint = this.sprint(id);
    if (!sprint) return fail('Sprint not found.');
    if (sprint.status !== 'planned') return fail('Only planned sprints can be activated.');
    const active = this.activeSprint;
    if (active) return fail(`${active.name} is still active. Close it before activating ${sprint.name}.`);
    // An over-allocated sprint can still start; say who is over.
    const reductions = findCapacityReductionConflicts(this.data, sprint, sprint.capacities);
    const next: Sprint = { ...sprint, status: 'active', updatedAt: this.now() };
    this.commit({ put: { sprints: [next] } });
    return okWithWarning(next, overAllocatedWarning(reductions, next.name));
  }

  closeSprint(id: ID, decisions: Record<ID, CloseDecision>, activateNextId?: ID | null): OpResult<Sprint> {
    let result;
    try {
      result = closeSprint(this.data, id, decisions, this.clock());
    } catch (e) {
      if (e instanceof SprintClosureError) {
        const detail = e.conflicts.length ? ` ${e.conflicts.map(describeConflict).join(' ')}` : '';
        return fail(e.message + detail, e.conflicts);
      }
      throw e;
    }
    const sprints: Sprint[] = [result.sprint];
    if (activateNextId) {
      const next = this.sprint(activateNextId);
      if (!next || next.status !== 'planned') return fail('The sprint to activate must be a planned sprint.');
      sprints.push({ ...next, status: 'active', updatedAt: this.now() });
    }
    this.commit({ put: { sprints, tickets: result.ticketUpdates } });
    const overSprints = [...new Set(result.overCapacity.map((c) => c.sprintId))].map((id) => this.sprint(id)!);
    const warnings = overSprints.map((t) => overAllocatedWarning(findCapacityReductionConflicts(this.data, t, t.capacities), t.name)).filter(Boolean);
    return okWithWarning(result.sprint, warnings.join(' ') || undefined);
  }

  /** Delete a planned sprint. Its tickets return to the backlog. */
  deleteSprint(id: ID): OpResult<{ returned: number }> {
    const sprint = this.sprint(id);
    if (!sprint) return fail('Sprint not found.');
    if (sprint.status !== 'planned') return fail('Only planned sprints can be deleted.');
    const ts = this.now();
    const tickets = this.data.tickets.filter((t) => t.sprintId === id).map((t) => ({ ...t, sprintId: null, updatedAt: ts }));
    this.commit({ put: { tickets }, delete: { sprints: [id] } });
    return ok({ returned: tickets.length });
  }

  // ---------------------------------------------------------------- backup

  exportBackup(): BackupFile {
    return createBackup(this.data, this.clock());
  }

  importData(data: AppData): OpResult {
    this.replace({ ...data, meta: { ...data.meta, initialized: true, schemaVersion: SCHEMA_VERSION } });
    return ok(undefined);
  }

  /** Replace everything with the sample workspace. Only ever runs when asked. */
  loadDemoData(): OpResult {
    this.replace(createDemoData(this.clock()));
    return ok(undefined);
  }

  /**
   * Clear everything: delete all projects, tasks, sprints and history, then start
   * a fresh empty active sprint. Team members and priority sections are kept.
   */
  clearWorkspace(): OpResult {
    const empty = createEmptyWorkspace(this.clock());
    const members = this.data.members.length ? this.data.members : empty.members;
    const sections = this.data.sections.length ? this.data.sections : empty.sections;
    this.replace({
      ...empty,
      members,
      sections,
      sprints: [makeStarterSprint(this.clock())],
      meta: { ...empty.meta, ticketKeyPrefix: this.data.meta.ticketKeyPrefix },
    });
    return ok(undefined);
  }
}

function overCapacityWarning(c: CapacityConflict): string {
  const after = formatPoints(c.allocatedElsewhere + c.requested);
  return `${c.memberName} is now at ${after} / ${formatPoints(c.capacity)} SP in ${c.sprintName}, ${formatPoints(c.overBy)} SP over capacity.`;
}

function overAllocatedWarning(over: { member: Member; capacity: number; allocated: number }[], sprintName: string): string | undefined {
  if (!over.length) return undefined;
  const who = over.map((r) => `${r.member.name} ${formatPoints(r.allocated)} / ${formatPoints(r.capacity)} SP`).join(', ');
  return `Over capacity in ${sprintName}: ${who}.`;
}

function normalizeCapacities(capacities: Record<ID, number>, members: Member[]): Record<ID, number> {
  const out: Record<ID, number> = {};
  for (const m of members) {
    const v = capacities[m.id];
    if (v === undefined) continue;
    const c = clampCapacity(v);
    if (c !== clampCapacity(m.defaultCapacity)) out[m.id] = c;
  }
  return out;
}
