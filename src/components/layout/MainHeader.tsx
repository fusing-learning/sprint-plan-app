import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { CalendarPlus, CheckCircle2, ChevronDown, ChevronRight, Gauge, Loader2, Lock, Menu, PanelLeftOpen, Pencil, Play, Square, Trash2, WifiOff } from 'lucide-react';
import { formatPoints, summarizeSprintCapacity } from '@/domain/capacity';
import { SPRINT_STATUS_LABEL, type Sprint } from '@/domain/types';
import { report, sortSprints, useData, useStore, useStoreState, useUi, usePlanningSprint } from '@/state/react';
import type { StoreState } from '@/state/planningStore';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { useConfirm } from '../ui/confirm';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Tooltip } from '../ui/misc';

interface Props {
  onCreateSprint: () => void;
  onEditSprint: (s: Sprint) => void;
  onCloseSprint: (s: Sprint) => void;
  onOpenMenu: () => void;
  onOpenCapacity: () => void;
}

export function MainHeader({ onCreateSprint, onEditSprint, onCloseSprint, onOpenMenu, onOpenCapacity }: Props) {
  const data = useData();
  const ui = useUi();
  const store = useStore();
  const confirm = useConfirm();
  const { pendingWrites, connection } = useStoreState();
  const planning = usePlanningSprint();
  const isHistory = ui.mode === 'history';
  const closed = sortSprints(data.sprints.filter((s) => s.status === 'closed')).reverse();
  const sprint = isHistory ? (closed.find((s) => s.id === ui.historySprintId) ?? closed[0] ?? null) : planning;
  const open = sortSprints(data.sprints.filter((s) => s.status !== 'closed'));
  const hasActive = data.sprints.some((s) => s.status === 'active');
  const summary = planning ? summarizeSprintCapacity(data, planning) : null;
  const crumb = isHistory ? 'Sprint history' : ui.mode === 'future' ? 'Future sprints' : 'Active sprint';

  const deleteSprint = async (s: Sprint) => {
    const n = data.tickets.filter((t) => t.sprintId === s.id).length;
    const ok = await confirm({
      title: `Delete ${s.name}?`,
      description: `${n} task${n === 1 ? '' : 's'} planned in this sprint will return to the backlog. Tasks are not deleted.`,
      confirmLabel: 'Delete sprint',
      destructive: true,
    });
    if (ok) report(store.deleteSprint(s.id), `${s.name} deleted`);
  };

  return (
    <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-1.5">
      <button type="button" onClick={onOpenMenu} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden" aria-label="Open menu">
        <Menu className="size-4" />
      </button>
      {ui.sidebarCollapsed && (
        <Tooltip content="Show sidebar">
          <button type="button" onClick={() => ui.setSidebarCollapsed(false)} className="hidden rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground lg:block" aria-label="Show sidebar">
            <PanelLeftOpen className="size-4" />
          </button>
        </Tooltip>
      )}

      <span className="hidden text-[13.5px] text-muted-foreground sm:inline">{crumb}</span>
      <ChevronRight className="hidden size-3.5 text-muted-foreground sm:block" />
      {sprint ? (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[13.5px] font-semibold hover:bg-muted data-[state=open]:bg-muted" aria-label="Select sprint">
              {sprint.name}
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              {open.length > 0 && <DropdownMenuLabel>Open sprints</DropdownMenuLabel>}
              {open.map((s) => (
                <SprintMenuItem key={s.id} sprint={s} current={s.id === sprint.id} onSelect={() => ui.setPlanningSprintId(s.id)} />
              ))}
              {closed.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>History</DropdownMenuLabel>
                  {closed.map((s) => (
                    <SprintMenuItem
                      key={s.id}
                      sprint={s}
                      current={s.id === sprint.id}
                      onSelect={() => {
                        ui.setHistorySprintId(s.id);
                        ui.setMode('history');
                      }}
                    />
                  ))}
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onCreateSprint}>
                <CalendarPlus /> Create sprint…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <SprintStatusPill sprint={sprint} />
          <SprintDates sprint={sprint} />
          {sprint.goal && <span className="hidden min-w-0 max-w-[280px] truncate text-[12.5px] text-muted-foreground 2xl:inline">· {sprint.goal}</span>}
        </>
      ) : (
        <span className="text-[13px] text-muted-foreground">{isHistory ? 'No closed sprints yet' : ui.mode === 'future' ? 'No future sprints' : 'No active sprint'}</span>
      )}

      <div className="ml-auto flex items-center gap-1">
        <SaveStatus pendingWrites={pendingWrites} connection={connection} />
        {summary && (
          <button
            type="button"
            onClick={onOpenCapacity}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12.5px] font-medium lg:hidden"
            aria-label="Open capacity"
          >
            <Gauge className="size-3.5" />
            {formatPoints(summary.totalUsed)}/{formatPoints(summary.totalCapacity)}
          </button>
        )}
        {sprint && sprint.status !== 'closed' && (
          <>
            <Button variant="ghost" size="sm" onClick={() => onEditSprint(sprint)}>
              <Pencil /> <span className="hidden md:inline">Edit sprint</span>
            </Button>
            {sprint.status === 'planned' && (
              <>
                <Tooltip content="Delete this planned sprint">
                  <Button variant="ghost" size="icon-sm" onClick={() => deleteSprint(sprint)} aria-label={`Delete ${sprint.name}`}>
                    <Trash2 />
                  </Button>
                </Tooltip>
                <Tooltip content={hasActive ? 'Close the active sprint first — only one sprint can be active' : `Make ${sprint.name} the active sprint`}>
                  <span>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={hasActive}
                      onClick={() => {
                        if (report(store.activateSprint(sprint.id), `${sprint.name} is now active`)) ui.setMode('active');
                      }}
                    >
                      <Play /> Activate
                    </Button>
                  </span>
                </Tooltip>
              </>
            )}
            {sprint.status === 'active' && (
              <Button variant="secondary" size="sm" onClick={() => onCloseSprint(sprint)}>
                <Square className="!size-3" /> Close sprint
              </Button>
            )}
          </>
        )}
        {sprint?.status === 'closed' && (
          <span className="inline-flex items-center gap-1 px-2 text-[12px] text-muted-foreground">
            <Lock className="size-3.5" /> Read-only
          </span>
        )}
        <Button size="sm" variant="ghost" onClick={onCreateSprint}>
          <CalendarPlus /> <span className="hidden md:inline">New sprint</span>
        </Button>
      </div>
    </header>
  );
}

function SprintMenuItem({ sprint, current, onSelect }: { sprint: Sprint; current: boolean; onSelect: () => void }) {
  return (
    <DropdownMenuItem onSelect={onSelect} className={cn(current && 'bg-muted/70')}>
      <span className={cn('size-2 rounded-full', sprint.status === 'active' ? 'bg-emerald-500' : sprint.status === 'planned' ? 'bg-violet-400' : 'bg-slate-300')} />
      <span className="font-medium">{sprint.name}</span>
      <span className="ml-auto text-[11.5px] text-muted-foreground">
        {format(parseISO(sprint.startDate), 'd MMM')} – {format(parseISO(sprint.endDate), 'd MMM')}
      </span>
    </DropdownMenuItem>
  );
}

function SprintStatusPill({ sprint }: { sprint: Sprint }) {
  const dot = sprint.status === 'active' ? 'bg-emerald-500' : sprint.status === 'planned' ? 'bg-violet-500' : 'bg-slate-400';
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[12px] font-medium text-foreground/75">
      <span className={cn('size-2 rounded-full', dot)} />
      {SPRINT_STATUS_LABEL[sprint.status]}
    </span>
  );
}

function SprintDates({ sprint }: { sprint: Sprint }) {
  const start = parseISO(sprint.startDate);
  const end = parseISO(sprint.endDate);
  const today = new Date();
  const length = differenceInCalendarDays(end, start) + 1;
  let note = '';
  if (sprint.status === 'active') {
    const day = differenceInCalendarDays(today, start) + 1;
    const left = differenceInCalendarDays(end, today);
    note = day < 1 ? `starts in ${1 - day}d` : left < 0 ? `ended ${-left}d ago` : `day ${day} of ${length} · ${left}d left`;
  } else if (sprint.status === 'planned') {
    const until = differenceInCalendarDays(start, today);
    note = until > 0 ? `starts in ${until}d` : 'ready to start';
  }
  return (
    <span className="hidden text-[12.5px] text-muted-foreground tabular md:inline">
      {format(start, 'd MMM')} – {format(end, 'd MMM')}
      {note && <span className="text-muted-foreground/80"> · {note}</span>}
    </span>
  );
}

function SaveStatus({ pendingWrites, connection }: Pick<StoreState, 'pendingWrites' | 'connection'>) {
  const local = connection === 'local';
  const offline = connection === 'offline' || connection === 'connecting';
  const tip = local
    ? pendingWrites > 0
      ? 'Saving to this browser…'
      : 'All changes saved in this browser'
    : offline
      ? 'Lost connection to the SprintFlow server. Reconnecting… Changes made now may not be saved.'
      : pendingWrites > 0
        ? 'Saving to the shared workspace…'
        : 'All changes saved. Edits from your team appear live.';
  return (
    <Tooltip content={tip}>
      <span className="mr-1 hidden items-center gap-1 text-[12px] text-muted-foreground xl:inline-flex" aria-live="polite">
        {offline ? (
          <WifiOff className="size-3.5 text-amber-500" />
        ) : pendingWrites > 0 ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <CheckCircle2 className="size-3.5 text-emerald-500" />
        )}
        {offline ? 'Reconnecting' : pendingWrites > 0 ? 'Saving' : local ? 'Saved' : 'Saved · Live'}
      </span>
    </Tooltip>
  );
}
