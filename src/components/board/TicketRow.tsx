import * as React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, CalendarRange, Copy, FolderInput, GripVertical, Inbox, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { Ticket } from '@/domain/types';
import { report, sortSprints, useData, useStore, useUi } from '@/state/react';
import { groupProjects, sortedSections } from '@/state/selectors';
import { cn } from '@/lib/utils';
import { Pill, SectionGlyph } from '../meta';
import { useConfirm } from '../ui/confirm';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Tooltip } from '../ui/misc';
import { AssigneePicker, PointsInput } from './pickers';

interface Props {
  ticket: Ticket;
  planningSprintId: string | null;
  onMove: (direction: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export function TicketRow({ ticket, planningSprintId, onMove, canMoveUp, canMoveDown }: Props) {
  const data = useData();
  const store = useStore();
  const ui = useUi();
  const confirm = useConfirm();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: ticket.id });

  const sprint = ticket.sprintId ? data.sprints.find((s) => s.id === ticket.sprintId) : undefined;
  const inPlanning = !!planningSprintId && ticket.sprintId === planningSprintId;
  const otherSprint = sprint && !inPlanning ? sprint : undefined;
  const missingAssignee = inPlanning && ticket.assigneeId === null;
  const missingEstimate = inPlanning && ticket.points === null;
  const openSprints = sortSprints(data.sprints.filter((s) => s.status !== 'closed'));

  const handleDelete = async () => {
    const ok = await confirm({
      title: `Delete ${ticket.key}?`,
      description: <>“{ticket.title}” will be permanently deleted.{inPlanning && ticket.points ? ' Its SP will be released from the sprint.' : ''}</>,
      confirmLabel: 'Delete task',
      destructive: true,
    });
    if (ok) report(store.deleteTicket(ticket.id), 'Task deleted');
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'group/row relative flex h-10 items-center gap-2.5 pl-3 pr-3 transition-colors sm:pl-9',
        'hover:bg-muted/60',
        isDragging && 'z-10 rounded-md bg-surface shadow-pop ring-1 ring-primary/30',
      )}
      data-testid="ticket-row"
      data-ticket-key={ticket.key}
    >
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${ticket.key}. Press space to pick up, arrow keys to move.`}
        className="absolute left-3 hidden h-6 w-4 cursor-grab items-center justify-center rounded text-slate-300 dark:text-slate-600 opacity-0 transition-opacity hover:text-slate-500 dark:hover:text-slate-400 focus-visible:opacity-100 group-hover/row:opacity-100 active:cursor-grabbing sm:flex"
      >
        <GripVertical className="size-3.5" />
      </button>

      <span className="hidden w-11 shrink-0 text-[12.5px] text-muted-foreground tabular sm:block">{ticket.key}</span>
      <button
        type="button"
        onClick={() => ui.openTicket(ticket.id)}
        className="min-w-[80px] flex-1 truncate text-left text-[13.5px] font-medium text-foreground hover:text-primary focus-visible:underline focus-visible:ring-0 focus-visible:ring-offset-0"
        title={ticket.title}
      >
        {ticket.title}
      </button>

      <div className="flex shrink-0 items-center gap-1.5">
        {(missingAssignee || missingEstimate) && (
          <Tooltip content="Incomplete planning item — in the sprint but not counted toward capacity until it has an assignee and SP.">
            <Pill tone="warn" dot="bg-orange-500" className="hidden md:inline-flex">
              {missingAssignee && missingEstimate ? 'No assignee · No SP' : missingAssignee ? 'No assignee' : 'No SP'}
            </Pill>
          </Tooltip>
        )}
        {(missingAssignee || missingEstimate) && <span className="size-2 rounded-full bg-orange-500 md:hidden" aria-label="Incomplete planning item" />}
        {otherSprint && (
          <Pill dot="bg-violet-500" className="hidden md:inline-flex">
            {otherSprint.name}
          </Pill>
        )}
        <AssigneePicker ticket={ticket} />
        <PointsInput ticket={ticket} />
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100 data-[state=open]:bg-muted data-[state=open]:opacity-100"
            aria-label={`Actions for ${ticket.key}`}
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => ui.openTicket(ticket.id)}>
              <Pencil /> Open details
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => report(store.duplicateTicket(ticket.id))}>
              <Copy /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <CalendarRange /> Move to sprint
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52">
                <DropdownMenuItem disabled={ticket.sprintId === null} onSelect={() => report(store.updateTicket(ticket.id, { sprintId: null }))}>
                  <Inbox /> Backlog
                </DropdownMenuItem>
                {openSprints.map((s) => (
                  <DropdownMenuItem key={s.id} disabled={ticket.sprintId === s.id} onSelect={() => report(store.updateTicket(ticket.id, { sprintId: s.id }))}>
                    <CalendarRange />
                    {s.name}
                    <span className="ml-auto text-[11px] text-muted-foreground">{s.status === 'active' ? 'Active' : 'Planned'}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <MoveToProjectSub ticket={ticket} />
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!canMoveUp} onSelect={() => onMove(-1)}>
              <ArrowUp /> Move up
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canMoveDown} onSelect={() => onMove(1)}>
              <ArrowDown /> Move down
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={handleDelete}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function MoveToProjectSub({ ticket }: { ticket: Ticket }) {
  const data = useData();
  const store = useStore();
  const byProject = groupProjects(data);
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <FolderInput /> Move to project
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-60">
        {sortedSections(data).map((section) => {
          const projects = (byProject.get(section.id) ?? []).filter((p) => p.lifecycle !== 'archived');
          if (!projects.length) return null;
          return (
            <React.Fragment key={section.id}>
              <DropdownMenuLabel>
                <span className="inline-flex items-center gap-1.5">
                  <SectionGlyph section={section} className="size-3" />
                  {section.name}
                </span>
              </DropdownMenuLabel>
              {projects.map((p) => (
                <DropdownMenuItem key={p.id} disabled={p.id === ticket.projectId} onSelect={() => report(store.updateTicket(ticket.id, { projectId: p.id }), `Moved to ${p.name}`)}>
                  <span className="truncate">{p.name}</span>
                </DropdownMenuItem>
              ))}
            </React.Fragment>
          );
        })}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
