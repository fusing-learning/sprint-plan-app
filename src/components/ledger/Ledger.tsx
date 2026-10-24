import * as React from 'react';
import { format, parseISO } from 'date-fns';
import { ArrowDownToLine, CalendarPlus, ChevronsDownUp, ChevronsUpDown, Layers, Plus, SearchX } from 'lucide-react';
import { toast } from 'sonner';
import { formatPoints, summarizeSprintCapacity } from '@/domain/capacity';
import { MAX_MEMBER_CAPACITY, type ID, type Project, type Section, type Sprint } from '@/domain/types';
import { useData, useStore, useUi, usePlanningSprint } from '@/state/react';
import { cutLineLedger, hasActiveFilters, matchesSearch, ticketMatches, type CutLineLedger, type LedgerMember } from '@/state/selectors';
import { cn } from '@/lib/utils';
import { Avatar } from '../meta';
import { Button } from '../ui/button';
import { Tooltip } from '../ui/misc';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { DeleteSectionDialog, SectionDialog } from '../dialogs/SectionDialogs';
import { ProjectDialog } from '../dialogs/ProjectDialog';
import { EmptyState } from '../board/Board';
import { FilterBar, useClearFilters } from '../board/FilterBar';
import { LedgerTable, type VisibleSection } from './LedgerTable';

/** Which sections and projects are open. Missing ids use the default: open unless not ranked. */
function useOpenOverrides(): [Record<ID, boolean>, (patch: Record<ID, boolean>) => void] {
  const [open, setOpen] = React.useState<Record<ID, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('sf.ledger.open') ?? '{}') as Record<ID, boolean>;
    } catch {
      return {};
    }
  });
  React.useEffect(() => {
    try {
      localStorage.setItem('sf.ledger.open', JSON.stringify(open));
    } catch {
      /* per-viewer convenience only */
    }
  }, [open]);
  return [open, React.useCallback((patch) => setOpen((prev) => ({ ...prev, ...patch })), [])];
}

export function Ledger({ onCreateSprint }: { onCreateSprint: () => void }) {
  const data = useData();
  const ui = useUi();
  const sprint = usePlanningSprint();
  const clearAll = useClearFilters();
  const [sectionDialog, setSectionDialog] = React.useState<{ section: Section | null } | null>(null);
  const [deleteSection, setDeleteSection] = React.useState<Section | null>(null);
  const [projectDialog, setProjectDialog] = React.useState<{ project: Project | null; sectionId?: string } | null>(null);
  const [flaggedOnly, setFlaggedOnly] = React.useState(false);
  const [overrides, setOverrides] = useOpenOverrides();

  const ledger = React.useMemo(() => (sprint ? cutLineLedger(data, sprint) : null), [data, sprint]);
  const { filters, search } = ui;
  const query = search.trim().toLowerCase();
  const filtersActive = hasActiveFilters(filters, search) || flaggedOnly;
  const onlySearch = !!query && !flaggedOnly && filters.scope === 'all' && filters.assignee === 'all' && filters.gap === 'none';

  const visible = React.useMemo<VisibleSection[]>(() => {
    if (!ledger) return [];
    const sections = ledger.sections.map((s) => {
      const projects = s.projects
        .filter((p) => (filters.showArchived ? p.project.lifecycle === 'archived' : p.project.lifecycle !== 'archived'))
        .map((p) => {
          const projectMatched = !!query && matchesSearch(`${p.project.name} ${p.project.description} ${p.project.owner}`, query);
          const tasks = p.tasks.filter((t) => ticketMatches(t.ticket, filters, query, ledger.sprintId, projectMatched) && (!flaggedOnly || t.state === 'incomplete'));
          return { ...p, visibleTasks: tasks, show: !filtersActive || tasks.length > 0 || (projectMatched && onlySearch) };
        })
        .filter((p) => p.show);
      return { ...s, visibleProjects: projects };
    });
    return filtersActive || filters.showArchived ? sections.filter((s) => s.visibleProjects.length > 0) : sections;
  }, [ledger, filters, query, flaggedOnly, filtersActive, onlySearch]);

  const isOpen = React.useCallback(
    (id: ID, byDefault: boolean) => overrides[id] ?? byDefault,
    [overrides],
  );

  // When a filter or search changes, open the sections and projects with matches — once.
  const filterKey = JSON.stringify([filters.scope, filters.assignee, filters.gap, query, filters.showArchived, flaggedOnly]);
  React.useEffect(() => {
    if (!filtersActive) return;
    const patch: Record<ID, boolean> = {};
    for (const s of visible) {
      patch[s.section.id] = true;
      for (const p of s.visibleProjects) if (p.visibleTasks.length) patch[p.project.id] = true;
    }
    setOverrides(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  const setAllOpen = (open: boolean) => {
    const patch: Record<ID, boolean> = {};
    for (const s of ledger?.sections ?? []) {
      patch[s.section.id] = open;
      for (const p of s.projects) patch[p.project.id] = open;
    }
    setOverrides(patch);
  };

  const sections = ledger?.sections ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col font-tight">
      <FilterBar ariaLabel="Ledger filters">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="text-muted-foreground" aria-label="Expand or collapse">
              <ChevronsUpDown /> <span className="hidden sm:inline">Expand</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => setAllOpen(true)}>
              <ChevronsUpDown /> Expand everything
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setAllOpen(false)}>
              <ChevronsDownUp /> Collapse everything
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setSectionDialog({ section: null })}>
          <Layers /> <span className="hidden sm:inline">Section</span>
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setProjectDialog({ project: null, sectionId: sections[0]?.section.id })} disabled={!data.sections.length}>
          <Plus /> <span className="hidden sm:inline">New project</span>
        </Button>
        {ledger && sprint && <FillToLineButton ledger={ledger} sprint={sprint} />}
      </FilterBar>

      <div className="relative min-h-0 flex-1 overflow-y-auto scrollbar-thin" data-testid="ledger-scroll">
        {!sprint || !ledger ? (
          <EmptyState
            icon={<CalendarPlus className="size-5" />}
            title="No sprint to plan"
            body="The ledger ranks your backlog against a sprint’s capacity. Create a sprint to see where the cut line falls."
            action={<Button onClick={onCreateSprint}>Create sprint</Button>}
          />
        ) : data.sections.length === 0 ? (
          <EmptyState
            icon={<Layers className="size-5" />}
            title="No priority sections"
            body="Sections order your projects from highest priority down. Create one to start planning."
            action={
              <Button onClick={() => setSectionDialog({ section: null })}>
                <Plus /> Add section
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-6 px-4 pb-20 pt-6 sm:px-6 xl:px-8">
            <LedgerSummary ledger={ledger} sprint={sprint} topSection={sections[0]?.section ?? null} />
            <CapacityStrip ledger={ledger} flaggedOnly={flaggedOnly} onToggleFlagged={() => setFlaggedOnly((v) => !v)} />
            {visible.length === 0 ? (
              <div className="rounded-xl border bg-surface">
                <EmptyState
                  icon={<SearchX className="size-5" />}
                  title={filters.showArchived && !filtersActive ? 'No archived projects' : 'Nothing matches'}
                  body={filters.showArchived && !filtersActive ? 'Archived projects will appear here.' : 'No tasks match the current search and filters.'}
                  action={
                    <Button
                      variant="secondary"
                      onClick={() => {
                        clearAll();
                        setFlaggedOnly(false);
                      }}
                    >
                      Clear filters
                    </Button>
                  }
                />
              </div>
            ) : (
              <LedgerTable
                ledger={ledger}
                sprint={sprint}
                sections={visible}
                sectionCount={sections.length}
                isOpen={isOpen}
                onToggle={(id, open) => setOverrides({ [id]: open })}
                onEditSection={(section) => setSectionDialog({ section })}
                onDeleteSection={setDeleteSection}
                onNewProject={(sectionId) => setProjectDialog({ project: null, sectionId })}
                onEditProject={(project) => setProjectDialog({ project })}
              />
            )}
          </div>
        )}
      </div>

      <SectionDialog open={!!sectionDialog} section={sectionDialog?.section ?? null} onOpenChange={(o) => !o && setSectionDialog(null)} />
      <DeleteSectionDialog section={deleteSection} onOpenChange={(o) => !o && setDeleteSection(null)} />
      <ProjectDialog
        open={!!projectDialog}
        project={projectDialog?.project ?? null}
        defaultSectionId={projectDialog?.sectionId}
        onOpenChange={(o) => !o && setProjectDialog(null)}
        onCreated={(p) => setOverrides({ [p.id]: true, [p.sectionId]: true })}
      />
    </div>
  );
}

/** Add the above-line tasks that aren't in the sprint yet. Each one still goes through the capacity check. */
function FillToLineButton({ ledger, sprint }: { ledger: CutLineLedger; sprint: Sprint }) {
  const store = useStore();
  const n = ledger.fillIds.length;
  const fill = () => {
    let added = 0;
    const errors: string[] = [];
    for (const id of ledger.fillIds) {
      const result = store.updateTicket(id, { sprintId: sprint.id });
      if (result.ok) added += 1;
      else errors.push(result.error);
    }
    const flagged = ledger.incomplete.count;
    const skipped = flagged ? `${flagged} flagged task${flagged === 1 ? '' : 's'} above the line need an owner and SP first.` : undefined;
    if (added) toast.success(`Added ${added} task${added === 1 ? '' : 's'} to ${sprint.name}`, { description: skipped });
    if (errors.length) toast.error(`${errors.length} task${errors.length === 1 ? '' : 's'} didn’t fit`, { description: errors[0], duration: 8000 });
  };
  return (
    <Tooltip content={n ? `Add the ${n} task${n === 1 ? '' : 's'} above the line that aren’t in ${sprint.name} yet. Capacity checks still apply.` : `Everything above the line is already in ${sprint.name}.`}>
      <span>
        <Button size="sm" onClick={fill} disabled={!n} className="bg-cut font-semibold text-cut-ink shadow-sm hover:bg-cut/90 active:bg-cut/95">
          <ArrowDownToLine /> Fill to line{n ? <span className="font-mono tabular">· {n}</span> : null}
        </Button>
      </span>
    </Tooltip>
  );
}

function LedgerSummary({ ledger, sprint, topSection }: { ledger: CutLineLedger; sprint: Sprint; topSection: Section | null }) {
  const data = useData();
  const summary = summarizeSprintCapacity(data, sprint);
  const cap = formatPoints(ledger.teamCapacity);
  const dates = `${format(parseISO(sprint.startDate), 'd MMM')} – ${format(parseISO(sprint.endDate), 'd MMM')}`;
  const topName = topSection ? topSection.name.split(/\s+[—–-]\s+/)[0] : 'the top';
  const flags = ledger.incomplete.count;
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-5">
      <div className="min-w-0 max-w-2xl">
        <div className="font-mono text-[12px] uppercase tracking-[0.04em] text-muted-foreground">
          {sprint.name} · {dates} · {sprint.status === 'active' ? 'Active' : 'Projected'}
        </div>
        <h1 className="mt-2 text-[28px] font-bold leading-[1.05] tracking-[-0.02em] sm:text-[34px]">Ranked top-down from {topName}</h1>
        <p className="mt-2 text-[14.5px] text-muted-foreground">
          Everything above the line fits {sprint.name}. Re-rank tasks or put a project on hold to move the line, then tick tasks into the sprint or fill to the line.
        </p>
      </div>
      <dl className="flex flex-wrap gap-x-8 gap-y-4">
        <Stat label="Above the line" value={formatPoints(ledger.abovePoints)} unit={` / ${cap} SP`} />
        <Stat label="Below the line" value={formatPoints(ledger.belowPoints)} unit={` SP · ${ledger.belowCount} task${ledger.belowCount === 1 ? '' : 's'}`} />
        <Stat label="Flags" value={String(flags)} valueClassName={flags ? 'text-flag' : undefined} />
        <Stat label={`In ${sprint.name}`} value={formatPoints(summary.totalUsed)} unit={` / ${formatPoints(summary.totalCapacity)} SP`} />
      </dl>
    </div>
  );
}

function Stat({ label, value, unit, valueClassName }: { label: string; value: string; unit?: string; valueClassName?: string }) {
  return (
    <div>
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className={cn('mt-1 font-mono text-[24px] font-bold leading-tight tabular sm:text-[28px]', valueClassName)}>
        {value}
        {unit && <span className="text-[15px] font-normal text-muted-foreground sm:text-[17px]">{unit}</span>}
      </dd>
    </div>
  );
}

function CapacityStrip({ ledger, flaggedOnly, onToggleFlagged }: { ledger: CutLineLedger; flaggedOnly: boolean; onToggleFlagged: () => void }) {
  const ui = useUi();
  const { count, noOwner, noPoints } = ledger.incomplete;
  return (
    <section aria-label="Capacity above the line" className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2.5">
      {ledger.members.map((m) => (
        <PersonCard
          key={m.member.id}
          m={m}
          selected={ui.filters.assignee === m.member.id}
          onClick={() => ui.setFilters({ assignee: ui.filters.assignee === m.member.id ? 'all' : m.member.id })}
        />
      ))}
      <button
        type="button"
        aria-pressed={flaggedOnly}
        disabled={!count && !flaggedOnly}
        onClick={onToggleFlagged}
        className={cn(
          'rounded-[10px] border border-dashed px-3.5 py-3 text-left transition-colors',
          count ? 'border-flag-line bg-flag-bg hover:border-flag' : 'cursor-default bg-surface',
          flaggedOnly && 'border-solid border-flag ring-1 ring-flag',
        )}
      >
        <div className={cn('font-semibold', count ? 'text-flag' : 'text-muted-foreground')}>Incomplete planning</div>
        <div className="mt-1.5 text-[12.5px] text-foreground/75">
          {count ? `${noOwner} without owner · ${noPoints} without SP` : 'Everything above the line has an owner and SP.'}
        </div>
      </button>
    </section>
  );
}

function PersonCard({ m, selected, onClick }: { m: LedgerMember; selected: boolean; onClick: () => void }) {
  const full = m.capacity > 0 && m.remaining <= 0;
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${m.member.name}: ${formatPoints(m.used)} of ${formatPoints(m.capacity)} SP above the line. ${selected ? 'Show everyone' : `Filter to ${m.member.name}`}`}
      onClick={onClick}
      className={cn('rounded-[10px] border bg-surface px-3.5 py-3 text-left transition-colors hover:border-foreground/20', selected && 'border-cut ring-1 ring-cut hover:border-cut')}
    >
      <div className="flex items-center gap-2">
        <Avatar member={m.member} size="md" />
        <span className="min-w-0 truncate font-semibold">{m.member.name}</span>
        <span className={cn('ml-auto font-mono text-[13px] font-bold tabular', full && 'text-cut-strong')}>
          {formatPoints(m.used)}
          <span className="font-normal text-muted-foreground">/{formatPoints(m.capacity)}</span>
        </span>
      </div>
      <div className="mt-2.5 grid grid-cols-10 gap-[3px]" aria-hidden>
        {Array.from({ length: MAX_MEMBER_CAPACITY }, (_, i) => {
          if (i >= m.capacity) return <span key={i} className="h-1.5 rounded-[2px] border border-dashed border-border" />;
          const fill = Math.max(0, Math.min(1, m.used - i, m.capacity - i));
          return (
            <span key={i} className="h-1.5 overflow-hidden rounded-[2px] bg-border">
              <span className={cn('block h-full', full ? 'bg-cut' : 'bg-muted-foreground')} style={{ width: `${fill * 100}%` }} />
            </span>
          );
        })}
      </div>
    </button>
  );
}
