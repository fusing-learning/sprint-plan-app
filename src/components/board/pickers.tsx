import * as React from 'react';
import { Check, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { findCapacityConflict, formatPoints, memberAllocation, memberCapacityFor, parsePoints } from '@/domain/capacity';
import type { Ticket } from '@/domain/types';
import { report, useData, useStore } from '@/state/react';
import { sortedMembers } from '@/state/selectors';
import { cn } from '@/lib/utils';
import { Avatar } from '../meta';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Tooltip } from '../ui/misc';

export function AssigneePicker({ ticket }: { ticket: Ticket }) {
  const data = useData();
  const store = useStore();
  const members = sortedMembers(data);
  const assignee = members.find((m) => m.id === ticket.assigneeId) ?? null;
  const sprint = ticket.sprintId ? data.sprints.find((s) => s.id === ticket.sprintId) : undefined;
  const openSprint = sprint && sprint.status !== 'closed' ? sprint : undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Assignee: ${assignee?.name ?? 'Unassigned'}`}
        className={cn(
          'inline-flex h-6 max-w-[140px] shrink-0 items-center gap-1.5 rounded-full border bg-surface pl-0.5 pr-2 text-[12px] font-medium text-foreground/80 transition-colors hover:border-slate-300 hover:bg-muted/60 data-[state=open]:border-slate-300',
          !assignee && 'border-dashed pl-2 text-muted-foreground',
        )}
      >
        {assignee && <Avatar member={assignee} size="xs" />}
        <span className="hidden truncate sm:inline">{assignee?.name ?? 'Assign'}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>{openSprint ? `Capacity left in ${openSprint.name}` : 'Backlog · uses no capacity'}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={ticket.assigneeId ?? '__none'}
          onValueChange={(v) => report(store.updateTicket(ticket.id, { assigneeId: v === '__none' ? null : v }))}
        >
          <DropdownMenuRadioItem value="__none">
            <Avatar member={null} size="xs" />
            <span className="text-muted-foreground">Unassigned</span>
          </DropdownMenuRadioItem>
          {members.map((m) => {
            let hint: React.ReactNode = null;
            if (openSprint) {
              const remaining = memberCapacityFor(openSprint, m) - memberAllocation(data.tickets, openSprint.id, m.id, ticket.id);
              const conflict = findCapacityConflict(data, { ...ticket, assigneeId: m.id });
              hint = (
                <span className={cn('ml-auto tabular text-[11.5px]', conflict ? 'text-red-600' : remaining <= 2 ? 'text-amber-700' : 'text-muted-foreground')}>
                  {conflict ? `won't fit · ${formatPoints(Math.max(0, remaining))}` : formatPoints(remaining)} SP
                </span>
              );
            }
            return (
              <DropdownMenuRadioItem key={m.id} value={m.id}>
                <Avatar member={m} size="xs" />
                <span className="truncate">{m.name}</span>
                {hint}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Free-text story points. Commits on Enter or blur; Escape reverts. Empty = unestimated. */
export function PointsInput({ ticket, className }: { ticket: Ticket; className?: string }) {
  const data = useData();
  const store = useStore();
  const current = ticket.points === null ? '' : formatPoints(ticket.points);
  const [value, setValue] = React.useState(current);
  const skipCommit = React.useRef(false);
  React.useEffect(() => setValue(current), [current]);

  const sprint = ticket.sprintId ? data.sprints.find((s) => s.id === ticket.sprintId) : undefined;
  const member = ticket.assigneeId ? data.members.find((m) => m.id === ticket.assigneeId) : undefined;
  const hint =
    sprint && sprint.status !== 'closed' && member
      ? `${member.name} has ${formatPoints(memberCapacityFor(sprint, member) - memberAllocation(data.tickets, sprint.id, member.id, ticket.id))} SP available in ${sprint.name}`
      : 'Story points (1 SP ≈ 1 person-day). Leave empty if not estimated.';

  const commit = () => {
    if (skipCommit.current) {
      skipCommit.current = false;
      return;
    }
    const parsed = parsePoints(value);
    if (!parsed.ok) {
      toast.error('Invalid story points', { description: parsed.error });
      setValue(current);
      return;
    }
    if (parsed.value === ticket.points) {
      setValue(current);
      return;
    }
    if (!report(store.updateTicket(ticket.id, { points: parsed.value }))) setValue(current);
  };

  return (
    <Tooltip content={hint}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            skipCommit.current = true;
            setValue(current);
            (e.target as HTMLInputElement).blur();
          }
        }}
        inputMode="decimal"
        placeholder="SP"
        aria-label={`Story points for ${ticket.key}`}
        data-testid="points-input"
        className={cn(
          'h-6 w-11 shrink-0 rounded-full border bg-surface text-center text-[12px] font-semibold tabular transition-colors placeholder:font-normal placeholder:text-muted-foreground/60 hover:border-slate-300 focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:ring-offset-0',
          ticket.points === null && 'border-dashed',
          className,
        )}
      />
    </Tooltip>
  );
}

/** One-click toggle: include/exclude the task from the sprint being planned. */
export function SprintToggle({ ticket, planningSprintId }: { ticket: Ticket; planningSprintId: string | null }) {
  const data = useData();
  const store = useStore();
  const planning = data.sprints.find((s) => s.id === planningSprintId);
  const current = ticket.sprintId ? data.sprints.find((s) => s.id === ticket.sprintId) : undefined;

  if (!planning) return <span className="size-4 shrink-0 rounded-[4px] border border-dashed border-slate-200" aria-hidden />;
  const inPlanning = ticket.sprintId === planning.id;
  const inOther = !!current && !inPlanning;
  const label = inPlanning ? `Remove from ${planning.name} (back to backlog)` : inOther ? `In ${current!.name} — move to ${planning.name}` : `Add to ${planning.name}`;

  return (
    <Tooltip content={label}>
      <button
        type="button"
        role="checkbox"
        aria-checked={inPlanning}
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          report(store.updateTicket(ticket.id, { sprintId: inPlanning ? null : planning.id }));
        }}
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-all',
          inPlanning
            ? 'border-primary bg-primary text-white hover:bg-primary/85'
            : inOther
              ? 'border-dashed border-violet-400 bg-violet-50 text-violet-500 hover:border-primary'
              : 'border-slate-300 bg-surface text-transparent hover:border-primary hover:text-primary/70',
        )}
      >
        {inPlanning ? <Check className="size-3" strokeWidth={3} /> : <Plus className="size-2.5" strokeWidth={3} />}
      </button>
    </Tooltip>
  );
}
