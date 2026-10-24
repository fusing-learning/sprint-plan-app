import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Box,
  CalendarClock,
  ChevronRight,
  FolderInput,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  User,
} from 'lucide-react';
import { formatPoints } from '@/domain/capacity';
import { PROJECT_LIFECYCLE_LABEL, type Project, type Ticket } from '@/domain/types';
import { report, useData, useStore, useUi } from '@/state/react';
import { mergeVisibleOrder, sortedSections, sprintPoints } from '@/state/selectors';
import { arrayMove, cn } from '@/lib/utils';
import { LIFECYCLE_DOT, Pill, SectionGlyph } from '../meta';
import { useConfirm } from '../ui/confirm';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Tooltip } from '../ui/misc';
import { QuickAddTicket } from './QuickAddTicket';
import { TicketRow } from './TicketRow';
import { verticalOnly } from './dnd';

interface Props {
  project: Project;
  allTickets: Ticket[];
  visibleTickets: Ticket[];
  planningSprintId: string | null;
  onEdit: (project: Project) => void;
  onMove: (direction: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export function ProjectCard({ project, allTickets, visibleTickets, planningSprintId, onEdit, onMove, canMoveUp, canMoveDown }: Props) {
  const data = useData();
  const store = useStore();
  const ui = useUi();
  const confirm = useConfirm();
  const expanded = ui.expanded.has(project.id);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: project.id });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const planning = data.sprints.find((s) => s.id === planningSprintId);
  const inSprint = planning ? allTickets.filter((t) => t.sprintId === planning.id).length : 0;
  const sprintPts = sprintPoints(allTickets, planningSprintId);
  const muted = project.lifecycle === 'archived' || project.lifecycle === 'completed';
  const target = project.targetDate ? parseISO(project.targetDate) : null;
  const daysToTarget = target ? differenceInCalendarDays(target, new Date()) : null;

  const reorder = (ids: string[]) => report(store.reorderTickets(project.id, mergeVisibleOrder(allTickets.map((t) => t.id), ids)));
  const handleDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = visibleTickets.map((t) => t.id);
    reorder(arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))));
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: `Delete “${project.name}”?`,
      description: (
        <div className="space-y-2">
          <p>
            This permanently deletes the project and its {allTickets.length} task{allTickets.length === 1 ? '' : 's'}. Any SP they use in open sprints is released.
          </p>
          <p>Closed sprint history is kept. Consider archiving instead.</p>
        </div>
      ),
      confirmLabel: 'Delete project',
      destructive: true,
    });
    if (ok) report(store.deleteProject(project.id), 'Project deleted');
  };

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn(isDragging && 'relative z-20 rounded-md bg-surface shadow-pop ring-1 ring-primary/30')} data-testid="project-card">
      <div className={cn('group/project relative flex h-11 items-center gap-2 pl-3 pr-3 transition-colors hover:bg-muted/60', muted && 'opacity-70')}>
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Reorder project ${project.name}`}
          className="absolute -left-0.5 hidden h-6 w-3.5 cursor-grab items-center justify-center rounded text-slate-300 dark:text-slate-600 opacity-0 transition-opacity hover:text-slate-500 dark:hover:text-slate-400 focus-visible:opacity-100 group-hover/project:opacity-100 active:cursor-grabbing sm:flex"
        >
          <GripVertical className="size-3.5" />
        </button>
        <button type="button" onClick={() => ui.toggleExpanded(project.id)} aria-expanded={expanded} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
          <Box className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-[60px] max-w-full shrink-0 truncate text-[13.5px] font-semibold" style={{ flexShrink: 0.2 }}>
            {project.name}
          </span>
          {project.description && <span className="hidden min-w-0 shrink truncate text-[13px] text-muted-foreground xl:inline">{project.description}</span>}
        </button>

        <div className="hidden shrink-0 items-center gap-1.5 md:flex">
          {project.lifecycle !== 'active' && <Pill dot={LIFECYCLE_DOT[project.lifecycle]}>{PROJECT_LIFECYCLE_LABEL[project.lifecycle]}</Pill>}
          {project.owner && (
            <Tooltip content="Project owner">
              <Pill icon={<User />}>{project.owner}</Pill>
            </Tooltip>
          )}
          {target && (
            <Tooltip content={`Target delivery ${format(target, 'EEE d MMM yyyy')}`}>
              <Pill
                icon={<CalendarClock />}
                className={cn(daysToTarget !== null && daysToTarget < 0 && project.lifecycle !== 'completed' ? 'border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300' : daysToTarget !== null && daysToTarget <= 14 ? 'border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-300' : '')}
              >
                {format(target, 'd MMM')}
              </Pill>
            </Tooltip>
          )}
          <span className="w-16 text-right text-[12px] text-muted-foreground tabular">
            {allTickets.length} task{allTickets.length === 1 ? '' : 's'}
          </span>
        </div>
        {planning && (
          <Tooltip content={`${inSprint} task${inSprint === 1 ? '' : 's'} · ${formatPoints(sprintPts)} SP allocated in ${planning.name}`}>
            <Pill tone={sprintPts > 0 ? 'accent' : 'muted'} className="min-w-[56px] justify-center tabular">
              {formatPoints(sprintPts)} SP
            </Pill>
          </Tooltip>
        )}
        <div className="flex shrink-0 items-center opacity-60 transition-opacity group-hover/project:opacity-100">
          <Tooltip content="Add task">
            <button
              type="button"
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={`Add task to ${project.name}`}
              onClick={() => {
                ui.toggleExpanded(project.id, true);
                ui.newTicket(project.id);
              }}
            >
              <Plus className="size-4" />
            </button>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted" aria-label={`Actions for project ${project.name}`}>
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={() => onEdit(project)}>
                <Pencil /> Edit project
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FolderInput /> Move to section
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">
                  {sortedSections(data).map((s) => (
                    <DropdownMenuItem key={s.id} disabled={s.id === project.sectionId} onSelect={() => report(store.updateProject(project.id, { sectionId: s.id }), `Moved to ${s.name}`)}>
                      <SectionGlyph section={s} className="size-3" />
                      <span className="truncate">{s.name}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem disabled={!canMoveUp} onSelect={() => onMove(-1)}>
                <ArrowUp /> Move up
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canMoveDown} onSelect={() => onMove(1)}>
                <ArrowDown /> Move down
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {project.lifecycle === 'archived' ? (
                <DropdownMenuItem onSelect={() => report(store.updateProject(project.id, { lifecycle: 'active' }), 'Project restored')}>
                  <ArchiveRestore /> Unarchive
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => report(store.updateProject(project.id, { lifecycle: 'archived' }), 'Project archived — find it under Archived in the sidebar')}>
                  <Archive /> Archive
                </DropdownMenuItem>
              )}
              <DropdownMenuItem destructive onSelect={handleDelete}>
                <Trash2 /> Delete project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {expanded && (
        <div className="pb-1">
          {visibleTickets.length > 0 ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[verticalOnly]}>
              <SortableContext items={visibleTickets.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                <div role="list" aria-label={`${project.name} tasks`}>
                  {visibleTickets.map((t, i) => (
                    <TicketRow
                      key={t.id}
                      ticket={t}
                      planningSprintId={planningSprintId}
                      canMoveUp={i > 0}
                      canMoveDown={i < visibleTickets.length - 1}
                      onMove={(dir) => {
                        const ids = visibleTickets.map((x) => x.id);
                        reorder(arrayMove(ids, i, i + dir));
                      }}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            allTickets.length > 0 && <div className="py-2 pl-9 text-[12.5px] text-muted-foreground">No tasks match the current filters.</div>
          )}
          <QuickAddTicket project={project} planningSprintId={planningSprintId} />
        </div>
      )}
    </div>
  );
}
