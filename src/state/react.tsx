import * as React from 'react';
import { toast } from 'sonner';
import type { ID, Sprint } from '@/domain/types';
import type { OpResult, PlanningStore } from './planningStore';

const StoreContext = React.createContext<PlanningStore | null>(null);

export function StoreProvider({ store, children }: { store: PlanningStore; children: React.ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): PlanningStore {
  const store = React.useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside StoreProvider');
  return store;
}

export function useStoreState() {
  const store = useStore();
  return React.useSyncExternalStore(store.subscribe, store.getState);
}

export function useData() {
  return useStoreState().data;
}

/** Show feedback for an operation result. Errors are never silent. Returns ok. */
export function report<T>(result: OpResult<T>, success?: string): result is Extract<OpResult<T>, { ok: true }> {
  if (!result.ok) {
    const isCapacity = !!result.conflicts?.length;
    toast.error(isCapacity ? 'Capacity conflict' : 'Could not complete that', { description: result.error, duration: isCapacity ? 8000 : 5000 });
    return false;
  }
  const message = success ?? result.message;
  if (message) toast.success(message);
  if (result.warning) toast.warning('Over capacity', { description: result.warning, duration: 8000 });
  return true;
}

// ----------------------------------------------------------------- UI state

export type ViewMode = 'active' | 'future' | 'history';
/** The board shows the sprint being planned, or the backlog. Other sprints' tasks appear when that sprint is selected. */
export type ScopeFilter = 'sprint' | 'backlog';
export type GapFilter = 'none' | 'unassigned' | 'unestimated' | 'incomplete';

export interface Filters {
  scope: ScopeFilter;
  assignee: 'all' | 'unassigned' | ID;
  gap: GapFilter;
  /** Show archived projects instead of active ones. */
  showArchived: boolean;
}

export const DEFAULT_FILTERS: Filters = {
  scope: 'sprint',
  assignee: 'all',
  gap: 'none',
  showArchived: false,
};

export type AllocationView = 'priority' | 'project';

interface UiState {
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
  /** Sprint the planning board and capacity panel are focused on (active or planned). */
  planningSprintId: ID | null;
  setPlanningSprintId: (id: ID | null) => void;
  historySprintId: ID | null;
  setHistorySprintId: (id: ID | null) => void;
  search: string;
  setSearch: (s: string) => void;
  filters: Filters;
  setFilters: (f: Partial<Filters>) => void;
  resetFilters: () => void;
  expanded: Set<ID>;
  toggleExpanded: (id: ID, open?: boolean) => void;
  setExpandedMany: (ids: ID[], open: boolean) => void;
  collapsedSections: Set<ID>;
  toggleSection: (id: ID, collapsed?: boolean) => void;
  setSectionsCollapsed: (ids: ID[], collapsed: boolean) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  allocationView: AllocationView;
  setAllocationView: (v: AllocationView) => void;
  /** Bring a section into view (expanding it). Set by the board. */
  scrollToSection: (id: ID) => void;
  openTicket: (ticketId: ID) => void;
  newTicket: (projectId: ID) => void;
  ticketDialog: { mode: 'edit'; ticketId: ID } | { mode: 'create'; projectId: ID } | null;
  closeTicketDialog: () => void;
}

const UiContext = React.createContext<UiState | null>(null);

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* per-viewer convenience only */
  }
}

export function UiProvider({ children }: { children: React.ReactNode }) {
  const data = useData();
  const [mode, setModeRaw] = React.useState<ViewMode>(() => readLocal('sf.mode', 'active'));
  const [planningSprintId, setPlanningSprintId] = React.useState<ID | null>(() => readLocal('sf.planningSprint', null));
  const [historySprintId, setHistorySprintId] = React.useState<ID | null>(null);
  const [search, setSearch] = React.useState('');
  const [filters, setFiltersRaw] = React.useState<Filters>(() => {
    const saved = readLocal<Partial<Filters>>('sf.filters', {});
    // 'all' was a scope before tasks defaulted to the sprint; it now means the sprint view.
    const scope: ScopeFilter = saved.scope === 'backlog' ? 'backlog' : 'sprint';
    return { scope, assignee: saved.assignee ?? 'all', gap: saved.gap ?? 'none', showArchived: saved.showArchived ?? false };
  });
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState<boolean>(() => readLocal('sf.sidebarCollapsed', false));
  const [allocationView, setAllocationView] = React.useState<AllocationView>(() => readLocal('sf.allocationView', 'priority'));
  const [expanded, setExpanded] = React.useState<Set<ID>>(() => new Set(readLocal<ID[]>('sf.expanded', [])));
  // Which workspace (identified by its top section) the default expansion was applied to.
  const [expandedFor, setExpandedFor] = React.useState<ID | null>(() => readLocal('sf.expandedFor', null));
  const [collapsedSections, setCollapsed] = React.useState<Set<ID>>(() => new Set(readLocal<ID[]>('sf.collapsedSections', [])));
  const [ticketDialog, setTicketDialog] = React.useState<UiState['ticketDialog']>(null);

  React.useEffect(() => writeLocal('sf.mode', mode), [mode]);
  React.useEffect(() => writeLocal('sf.planningSprint', planningSprintId), [planningSprintId]);
  React.useEffect(() => writeLocal('sf.filters', filters), [filters]);
  React.useEffect(() => writeLocal('sf.expanded', [...expanded]), [expanded]);
  React.useEffect(() => writeLocal('sf.collapsedSections', [...collapsedSections]), [collapsedSections]);
  React.useEffect(() => writeLocal('sf.sidebarCollapsed', sidebarCollapsed), [sidebarCollapsed]);
  React.useEffect(() => writeLocal('sf.allocationView', allocationView), [allocationView]);

  // Keep a stale filter (e.g. a removed member) from hiding everything.
  React.useEffect(() => {
    if (filters.assignee !== 'all' && filters.assignee !== 'unassigned' && !data.members.some((m) => m.id === filters.assignee)) {
      setFiltersRaw((f) => ({ ...f, assignee: 'all' }));
    }
  }, [data.members, filters.assignee]);

  // New workspace (first run, reset or import): expand the top section's projects so planning starts at P0.
  React.useEffect(() => {
    if (!data.sections.length) return;
    const knownSection = expandedFor && data.sections.some((s) => s.id === expandedFor);
    if (knownSection) return;
    const top = [...data.sections].sort((a, b) => a.order - b.order)[0];
    setExpanded(new Set(data.projects.filter((p) => p.sectionId === top.id).map((p) => p.id)));
    setExpandedFor(top.id);
    writeLocal('sf.expandedFor', top.id);
  }, [data.sections, data.projects, expandedFor]);

  // Keep the focused sprint valid as sprints change.
  const resolved = React.useMemo(() => resolveSprints(data.sprints, mode, planningSprintId, historySprintId), [
    data.sprints,
    mode,
    planningSprintId,
    historySprintId,
  ]);

  const setMode = React.useCallback(
    (m: ViewMode) => {
      setModeRaw(m);
      if (m === 'active') setPlanningSprintId(data.sprints.find((s) => s.status === 'active')?.id ?? null);
      if (m === 'future') {
        const current = data.sprints.find((s) => s.id === planningSprintId);
        if (!current || current.status !== 'planned') {
          setPlanningSprintId(sortSprints(data.sprints.filter((s) => s.status === 'planned'))[0]?.id ?? null);
        }
      }
    },
    [data.sprints, planningSprintId],
  );

  const value: UiState = {
    mode,
    setMode,
    planningSprintId: resolved.planningSprintId,
    setPlanningSprintId: (id) => {
      setPlanningSprintId(id);
      const s = data.sprints.find((x) => x.id === id);
      if (s) setModeRaw(s.status === 'active' ? 'active' : s.status === 'planned' ? 'future' : 'history');
    },
    historySprintId: resolved.historySprintId,
    setHistorySprintId,
    search,
    setSearch,
    filters,
    setFilters: (f) => setFiltersRaw((prev) => ({ ...prev, ...f })),
    resetFilters: () => setFiltersRaw((prev) => ({ ...DEFAULT_FILTERS, showArchived: prev.showArchived })),
    expanded,
    toggleExpanded: (id, open) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        const shouldOpen = open ?? !next.has(id);
        if (shouldOpen) next.add(id);
        else next.delete(id);
        return next;
      }),
    setExpandedMany: (ids, open) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => (open ? next.add(id) : next.delete(id)));
        return next;
      }),
    collapsedSections,
    toggleSection: (id, collapsed) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        const shouldCollapse = collapsed ?? !next.has(id);
        if (shouldCollapse) next.add(id);
        else next.delete(id);
        return next;
      }),
    setSectionsCollapsed: (ids, collapsed) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => (collapsed ? next.add(id) : next.delete(id)));
        return next;
      }),
    sidebarCollapsed,
    setSidebarCollapsed,
    allocationView,
    setAllocationView,
    scrollToSection: (id) => {
      setModeRaw((m) => (m === 'history' ? 'active' : m));
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      requestAnimationFrame(() => document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    },
    openTicket: (ticketId) => setTicketDialog({ mode: 'edit', ticketId }),
    newTicket: (projectId) => setTicketDialog({ mode: 'create', projectId }),
    ticketDialog,
    closeTicketDialog: () => setTicketDialog(null),
  };

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi(): UiState {
  const ui = React.useContext(UiContext);
  if (!ui) throw new Error('useUi must be used inside UiProvider');
  return ui;
}

export function sortSprints(sprints: Sprint[]): Sprint[] {
  return [...sprints].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.createdAt.localeCompare(b.createdAt));
}

function resolveSprints(sprints: Sprint[], mode: ViewMode, planningId: ID | null, historyId: ID | null) {
  const active = sprints.find((s) => s.status === 'active');
  const planned = sortSprints(sprints.filter((s) => s.status === 'planned'));
  const closed = sortSprints(sprints.filter((s) => s.status === 'closed')).reverse();
  let planningSprintId: ID | null = null;
  const chosen = sprints.find((s) => s.id === planningId && s.status !== 'closed');
  if (mode === 'active') planningSprintId = active?.id ?? chosen?.id ?? planned[0]?.id ?? null;
  else if (mode === 'future') planningSprintId = chosen?.status === 'planned' ? chosen.id : (planned[0]?.id ?? null);
  else planningSprintId = active?.id ?? chosen?.id ?? planned[0]?.id ?? null;
  const historySprintId = sprints.find((s) => s.id === historyId && s.status === 'closed')?.id ?? closed[0]?.id ?? null;
  return { planningSprintId, historySprintId };
}

/** The sprint currently in focus for planning, if any. */
export function usePlanningSprint(): Sprint | null {
  const data = useData();
  const { planningSprintId } = useUi();
  return data.sprints.find((s) => s.id === planningSprintId) ?? null;
}
