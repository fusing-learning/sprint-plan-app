import * as React from 'react';
import { Archive, CalendarCheck2, CalendarClock, Database, HardDrive, History, Radio, Inbox, Layers, PanelLeftClose, Search, UserX, Users } from 'lucide-react';
import { formatPoints, memberAllocation, memberCapacityFor } from '@/domain/capacity';
import { useData, useStoreState, useUi, usePlanningSprint, type ScopeFilter, type ViewMode } from '@/state/react';
import { isOnBoard, sortedMembers, sortedSections } from '@/state/selectors';
import { cn } from '@/lib/utils';
import { Avatar, SectionGlyph } from '../meta';
import { Kbd, Tooltip } from '../ui/misc';

interface Props {
  onTeam: () => void;
  onData: () => void;
  onNavigate?: () => void;
  showCollapse?: boolean;
}

/** Left navigation: views, scope, people and sections. All filters live here. */
export function Sidebar({ onTeam, onData, onNavigate, showCollapse = true }: Props) {
  const data = useData();
  const ui = useUi();
  const planning = usePlanningSprint();
  const { connection } = useStoreState();
  const searchRef = React.useRef<HTMLInputElement>(null);
  const closedIds = new Set(data.sprints.filter((s) => s.status === 'closed').map((s) => s.id));
  const boardTickets = data.tickets.filter((t) => isOnBoard(t, closedIds));
  const planned = data.sprints.filter((s) => s.status === 'planned').length;
  const closed = closedIds.size;
  const archived = data.projects.filter((p) => p.lifecycle === 'archived').length;
  const planningMode = ui.mode !== 'history';

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"], [role="dialog"]');
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = (fn: () => void) => () => {
    fn();
    onNavigate?.();
  };
  const setMode = (m: ViewMode) => go(() => ui.setMode(m));
  const setScope = (scope: ScopeFilter) =>
    go(() => {
      if (ui.mode === 'history') ui.setMode('active');
      ui.setFilters({ scope, showArchived: false });
    });
  const setAssignee = (assignee: string) =>
    go(() => {
      if (ui.mode === 'history') ui.setMode('active');
      ui.setFilters({ assignee: ui.filters.assignee === assignee ? 'all' : assignee, gap: 'none' });
    });

  return (
    <nav className="flex h-full flex-col" aria-label="Sidebar">
      <div className="flex h-12 shrink-0 items-center gap-2 px-4">
        <span className="flex size-6 items-center justify-center rounded-md bg-primary text-white shadow-sm">
          <svg viewBox="0 0 32 32" className="size-3.5" aria-hidden>
            <path d="M7 21c2.8 0 3.9-10 8.5-10S21.2 21 25 21" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" />
          </svg>
        </span>
        <span className="text-[14px] font-semibold tracking-tight">SprintFlow</span>
        {showCollapse && (
          <Tooltip content="Hide sidebar">
            <button type="button" onClick={() => ui.setSidebarCollapsed(true)} className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-black/5 hover:text-foreground" aria-label="Hide sidebar">
              <PanelLeftClose className="size-4" />
            </button>
          </Tooltip>
        )}
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchRef}
            type="search"
            value={ui.search}
            onChange={(e) => {
              ui.setSearch(e.target.value);
              if (ui.mode === 'history' && e.target.value) ui.setMode('active');
            }}
            onKeyDown={(e) => e.key === 'Escape' && (ui.setSearch(''), (e.target as HTMLInputElement).blur())}
            placeholder="Search"
            aria-label="Search tasks and projects"
            className="h-8 w-full rounded-md border border-transparent bg-black/[0.04] pl-8 pr-8 text-[13px] transition-colors placeholder:text-muted-foreground hover:bg-black/[0.06] focus-visible:border-primary/50 focus-visible:bg-surface focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:ring-offset-0 [&::-webkit-search-cancel-button]:hidden"
          />
          {!ui.search && <Kbd className="absolute right-2 top-1/2 -translate-y-1/2 bg-transparent">/</Kbd>}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-3 scrollbar-thin">
        <Group>
          <NavItem icon={<CalendarCheck2 />} label="Active sprint" active={ui.mode === 'active'} onClick={setMode('active')} />
          <NavItem icon={<CalendarClock />} label="Future sprints" count={planned} active={ui.mode === 'future'} onClick={setMode('future')} />
          <NavItem icon={<History />} label="Sprint history" count={closed} active={ui.mode === 'history'} onClick={setMode('history')} />
        </Group>

        <Group title="Show">
          <NavItem icon={<Layers />} label="All tasks" count={boardTickets.length} active={planningMode && ui.filters.scope === 'all' && !ui.filters.showArchived} onClick={setScope('all')} />
          <NavItem
            icon={<CalendarCheck2 />}
            label={planning ? `In ${planning.name}` : 'In sprint'}
            count={planning ? boardTickets.filter((t) => t.sprintId === planning.id).length : 0}
            active={planningMode && ui.filters.scope === 'sprint' && !ui.filters.showArchived}
            onClick={setScope('sprint')}
          />
          <NavItem icon={<Inbox />} label="Backlog" count={boardTickets.filter((t) => t.sprintId === null).length} active={planningMode && ui.filters.scope === 'backlog' && !ui.filters.showArchived} onClick={setScope('backlog')} />
          <NavItem
            icon={<Archive />}
            label="Archived projects"
            count={archived}
            active={planningMode && ui.filters.showArchived}
            onClick={go(() => {
              if (ui.mode === 'history') ui.setMode('active');
              ui.setFilters({ showArchived: !ui.filters.showArchived });
            })}
          />
        </Group>

        <Group title="People">
          {sortedMembers(data).map((m) => {
            const cap = planning ? memberCapacityFor(planning, m) : null;
            const used = planning ? memberAllocation(data.tickets, planning.id, m.id) : null;
            return (
              <NavItem
                key={m.id}
                icon={<Avatar member={m} size="xs" />}
                label={m.name}
                trailing={cap !== null && used !== null ? <span className={cn('tabular', used >= cap && cap > 0 && 'text-emerald-600')}>{`${formatPoints(used)}/${formatPoints(cap)}`}</span> : undefined}
                active={planningMode && ui.filters.assignee === m.id}
                onClick={setAssignee(m.id)}
              />
            );
          })}
          <NavItem
            icon={<UserX />}
            label="Unassigned"
            count={boardTickets.filter((t) => t.assigneeId === null).length}
            active={planningMode && ui.filters.assignee === 'unassigned'}
            onClick={setAssignee('unassigned')}
          />
        </Group>

        <Group title="Sections">
          {sortedSections(data).map((s) => (
            <NavItem
              key={s.id}
              icon={<SectionGlyph section={s} className="size-3" />}
              label={s.name}
              count={data.projects.filter((p) => p.sectionId === s.id && p.lifecycle !== 'archived').length}
              onClick={go(() => ui.scrollToSection(s.id))}
            />
          ))}
        </Group>
      </div>

      <div className="space-y-0.5 border-t border-black/5 px-3 py-2">
        <NavItem icon={<Users />} label="Team settings" onClick={go(onTeam)} />
        <NavItem icon={<Database />} label="Import / Export / Clear" onClick={go(onData)} />
        {connection === 'local' ? (
          <NavItem icon={<HardDrive />} label="Saved in this browser only" muted />
        ) : (
          <NavItem icon={<Radio />} label={connection === 'live' ? 'Shared workspace · live' : 'Shared workspace · reconnecting…'} muted />
        )}
      </div>
    </nav>
  );
}

function Group({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div>
      {title && <div className="px-2 pb-1 text-[12px] font-medium text-muted-foreground">{title}</div>}
      <div className="space-y-px">{children}</div>
    </div>
  );
}

function NavItem({
  icon,
  label,
  count,
  trailing,
  active,
  muted,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  trailing?: React.ReactNode;
  active?: boolean;
  muted?: boolean;
  onClick?: () => void;
}) {
  if (muted) {
    return (
      <div className="flex h-7 items-center gap-2 px-2 text-[12px] text-muted-foreground/80 [&_svg]:size-3.5">
        <span className="flex w-4 justify-center">{icon}</span>
        {label}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-[13px] font-medium text-foreground/80 transition-colors hover:bg-black/[0.05] [&_svg]:size-4 [&_svg]:text-muted-foreground',
        active && 'bg-black/[0.07] text-foreground hover:bg-black/[0.07]',
      )}
    >
      <span className="flex w-4 shrink-0 justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing !== undefined ? <span className="text-[12px] font-normal text-muted-foreground">{trailing}</span> : count !== undefined && count > 0 ? <span className="text-[12px] font-normal text-muted-foreground tabular">{count}</span> : null}
    </button>
  );
}
