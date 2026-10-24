import * as React from 'react';
import { Archive, CalendarCheck2, ListFilter, Plus, SearchX, UserX, Users, X } from 'lucide-react';
import { useData, useUi, usePlanningSprint, type ScopeFilter } from '@/state/react';
import { hasActiveFilters, sortedMembers } from '@/state/selectors';
import { cn } from '@/lib/utils';
import { Avatar } from '../meta';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

const SCOPE_LABEL: Record<ScopeFilter, string> = { all: 'All tasks', sprint: 'In sprint', backlog: 'Backlog' };

/** Clear search, filters and the archived toggle. */
export function useClearFilters() {
  const ui = useUi();
  return () => {
    ui.resetFilters();
    ui.setSearch('');
    ui.setFilters({ showArchived: false });
  };
}

/** Filter chips and the Filter menu shared by the board and the ledger. View-specific actions go in `children`. */
export function FilterBar({ children, ariaLabel = 'Board filters' }: { children?: React.ReactNode; ariaLabel?: string }) {
  const data = useData();
  const ui = useUi();
  const planning = usePlanningSprint();
  const { filters, search } = ui;
  const filtersActive = hasActiveFilters(filters, search);
  const query = search.trim().toLowerCase();
  const members = sortedMembers(data);
  const assignee = members.find((m) => m.id === filters.assignee);
  const clearAll = useClearFilters();

  return (
    <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-1.5" role="toolbar" aria-label={ariaLabel}>
      {filters.scope !== 'all' && (
        <FilterChip label="Scope" value={filters.scope === 'sprint' ? `In ${planning?.name ?? 'sprint'}` : 'Backlog'} icon={<CalendarCheck2 />} onClear={() => ui.setFilters({ scope: 'all' })} />
      )}
      {filters.assignee !== 'all' && (
        <FilterChip
          label="Assignee"
          value={assignee?.name ?? 'Unassigned'}
          icon={assignee ? <Avatar member={assignee} size="xs" /> : <UserX />}
          onClear={() => ui.setFilters({ assignee: 'all' })}
        />
      )}
      {filters.gap !== 'none' && (
        <FilterChip label="Planning" value={filters.gap === 'unassigned' ? 'No assignee' : 'No SP'} icon={<span className="size-2 rounded-full bg-orange-500" />} onClear={() => ui.setFilters({ gap: 'none' })} />
      )}
      {filters.showArchived && <FilterChip label="Projects" value="Archived" icon={<Archive />} onClear={() => ui.setFilters({ showArchived: false })} />}
      {query && <FilterChip label="Search" value={`“${search.trim()}”`} icon={<SearchX />} onClear={() => ui.setSearch('')} />}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="text-muted-foreground">
            {filtersActive || filters.showArchived ? <Plus /> : <ListFilter />}
            {filtersActive || filters.showArchived ? '' : 'Filter'}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <CalendarCheck2 /> Scope
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-44">
              <DropdownMenuRadioGroup value={filters.scope} onValueChange={(v) => ui.setFilters({ scope: v as ScopeFilter })}>
                {(Object.keys(SCOPE_LABEL) as ScopeFilter[]).map((s) => (
                  <DropdownMenuRadioItem key={s} value={s}>
                    {s === 'sprint' && planning ? `In ${planning.name}` : SCOPE_LABEL[s]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Users /> Assignee
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-48">
              <DropdownMenuRadioGroup value={filters.assignee} onValueChange={(v) => ui.setFilters({ assignee: v })}>
                <DropdownMenuRadioItem value="all">Everyone</DropdownMenuRadioItem>
                {members.map((m) => (
                  <DropdownMenuRadioItem key={m.id} value={m.id}>
                    <Avatar member={m} size="xs" /> {m.name}
                  </DropdownMenuRadioItem>
                ))}
                <DropdownMenuRadioItem value="unassigned">
                  <UserX /> Unassigned
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => ui.setFilters({ showArchived: !filters.showArchived })}>
            <Archive /> {filters.showArchived ? 'Show active projects' : 'Show archived projects'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {(filtersActive || filters.showArchived) && (
        <button type="button" onClick={clearAll} className="text-[12.5px] text-muted-foreground hover:text-foreground">
          Clear
        </button>
      )}

      <div className="ml-auto flex items-center gap-1">{children}</div>
    </div>
  );
}

function FilterChip({ label, value, icon, onClear }: { label: string; value: string; icon: React.ReactNode; onClear: () => void }) {
  return (
    <span className="inline-flex h-7 items-center overflow-hidden rounded-md border bg-surface text-[12.5px] shadow-sm">
      <span className="flex h-full items-center gap-1.5 border-r px-2 text-muted-foreground [&_svg]:size-3.5">
        {icon}
        {label}
      </span>
      <span className="border-r px-2 text-muted-foreground">is</span>
      <span className="px-2 font-medium">{value}</span>
      <button type="button" onClick={onClear} className={cn('flex h-full items-center border-l px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground')} aria-label={`Remove ${label} filter`}>
        <X className="size-3.5" />
      </button>
    </span>
  );
}
