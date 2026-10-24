import * as React from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { format, parseISO } from 'date-fns';
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, ChevronRight, FolderInput, GripVertical, MoreHorizontal, Pause, Pencil, Play, Plus, Scissors, Trash2 } from 'lucide-react';
import { formatPoints } from '@/domain/capacity';
import { PROJECT_LIFECYCLE_LABEL, type ID, type Project, type Section, type Sprint } from '@/domain/types';
import { report, useData, useStore, useUi } from '@/state/react';
import { describeCutReason, mergeVisibleOrder, sortedSections, type CutLineLedger, type LedgerProject, type LedgerSection, type LedgerTask } from '@/state/selectors';
import { arrayMove, cn } from '@/lib/utils';
import { Pill, SECTION_COLORS, SectionGlyph } from '../meta';
import { Tooltip } from '../ui/misc';
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
import { AssigneePicker, PointsInput, SprintToggle } from '../board/pickers';
import { QuickAddTicket } from '../board/QuickAddTicket';
import { TicketActions } from '../board/TicketRow';
import { verticalOnly } from '../board/dnd';

export type VisibleProject = LedgerProject & { visibleTasks: LedgerTask[] };
export type VisibleSection = LedgerSection & { visibleProjects: VisibleProject[] };

/** Where the cut line row is drawn, given what's collapsed or filtered out. */
type CutAt = { before: ID } | { afterProject: ID } | { afterSection: ID } | 'end' | null;

interface Props {
  ledger: CutLineLedger;
  sprint: Sprint;
  sections: VisibleSection[];
  sectionCount: number;
  isOpen: (id: ID, byDefault: boolean) => boolean;
  onToggle: (id: ID, open: boolean) => void;
  onEditSection: (s: Section) => void;
  onDeleteSection: (s: Section) => void;
  onNewProject: (sectionId: ID) => void;
  onEditProject: (p: Project) => void;
}

// dnd-kit renders its screen-reader text as a <div>, which isn't allowed inside a table. Portal it out.
const tableDndA11y = { container: typeof document === 'undefined' ? undefined : document.body };

const sectionOpenByDefault = (s: LedgerSection) => !s.notThisSprint;
const projectOpenByDefault = (p: LedgerProject) => !p.excluded;
const isBelow = (t: LedgerTask) => t.state === 'below';

function totalLabel(above: number, below: number) {
  return `${formatPoints(above)} SP${below ? ` · ${formatPoints(below)} below line` : ''}`;
}

export function LedgerTable(props: Props) {
  const { ledger, sections, isOpen } = props;
  const store = useStore();
  const allSectionIds = sortedSections(useData()).map((s) => s.id);

  // The cut goes before the first visible below-line task; if that task is hidden by a collapsed
  // project or section, the line sits right under that header instead.
  let cutAt: CutAt = null;
  if (ledger.cut) {
    cutAt = 'end';
    search: for (const s of sections) {
      if (!isOpen(s.section.id, sectionOpenByDefault(s))) {
        if (s.visibleProjects.some((p) => p.visibleTasks.some(isBelow))) {
          cutAt = { afterSection: s.section.id };
          break;
        }
        continue;
      }
      for (const p of s.visibleProjects) {
        const first = p.visibleTasks.find(isBelow);
        if (!first) continue;
        cutAt = isOpen(p.project.id, projectOpenByDefault(p)) ? { before: first.ticket.id } : { afterProject: p.project.id };
        break search;
      }
    }
  }

  return (
    <div className="relative overflow-x-auto rounded-xl border bg-surface scrollbar-thin" data-testid="ledger">
      <table className="w-full min-w-[800px] table-fixed border-collapse text-[13.5px]">
        <caption className="sr-only">Tasks ranked by priority, with the running total of SP against {props.sprint.name}’s capacity</caption>
        <thead>
          <tr className="text-left text-[12px] text-muted-foreground">
            <th scope="col" className="w-[92px] py-3 pl-5 pr-2 font-medium">
              #
            </th>
            <th scope="col" className="px-2 py-3 font-medium">
              Task
            </th>
            <th scope="col" className="w-[152px] px-2 py-3 font-medium">
              Owner
            </th>
            <th scope="col" className="w-[68px] px-2 py-3 text-center font-medium">
              SP
            </th>
            <th scope="col" className="w-[156px] py-3 pl-2 pr-5 font-medium">
              Running total
            </th>
          </tr>
        </thead>
        {sections.map((s) => (
          <SectionGroup
            key={s.section.id}
            {...props}
            s={s}
            cutAt={cutAt}
            index={allSectionIds.indexOf(s.section.id)}
            onMoveSection={(dir) => {
              const i = allSectionIds.indexOf(s.section.id);
              report(store.reorderSections(arrayMove(allSectionIds, i, i + dir)));
            }}
          />
        ))}
        <tbody>
          {cutAt === 'end' && <CutRow ledger={ledger} />}
          {!ledger.cut && (
            <tr className="border-t">
              <td colSpan={5} className="px-5 py-3 text-[12.5px] text-muted-foreground">
                Everything ranked fits. <span className="font-mono">{formatPoints(ledger.teamCapacity - ledger.abovePoints)} SP</span> of capacity left.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function SectionGroup(props: Props & { s: VisibleSection; cutAt: CutAt; index: number; onMoveSection: (dir: -1 | 1) => void }) {
  const { s, isOpen, onToggle, cutAt } = props;
  const store = useStore();
  const section = s.section;
  const open = isOpen(section.id, sectionOpenByDefault(s));
  const color = SECTION_COLORS[section.color];
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const visibleIds = s.visibleProjects.map((p) => p.project.id);
  const reorderProjects = (ids: ID[]) => report(store.reorderProjects(section.id, mergeVisibleOrder(s.projects.map((p) => p.project.id), ids)));
  const handleDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    reorderProjects(arrayMove(visibleIds, visibleIds.indexOf(String(e.active.id)), visibleIds.indexOf(String(e.over.id))));
  };

  return (
    <>
      <tbody>
        <tr id={`section-${section.id}`} className="scroll-mt-2" data-testid="ledger-section">
          <th scope="rowgroup" colSpan={5} className="border-t px-5 pb-2.5 pt-5 text-left font-normal">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <button type="button" onClick={() => onToggle(section.id, !open)} aria-expanded={open} className="-ml-1.5 flex min-h-8 items-center gap-2.5 rounded-md px-1.5 hover:bg-muted">
                <ChevronRight className={cn('size-3.5 text-muted-foreground transition-transform', open && 'rotate-90')} />
                <span className={cn('size-2.5 rounded-[3px]', color.dot)} aria-hidden />
                <span className={cn('text-[13px] font-bold uppercase tracking-[0.04em]', color.text)}>{section.name}</span>
              </button>
              <span className="ml-auto font-mono text-[12px] font-medium text-muted-foreground">
                {s.notThisSprint ? 'Not this sprint' : s.projects.length === 0 ? 'No projects' : totalLabel(s.abovePoints, s.belowPoints)}
              </span>
              <SectionMenu {...props} />
            </div>
          </th>
        </tr>
        {typeof cutAt === 'object' && cutAt && 'afterSection' in cutAt && cutAt.afterSection === section.id && <CutRow ledger={props.ledger} />}
        {open && s.visibleProjects.length === 0 && (
          <tr>
            <td colSpan={5} className="pb-3 pl-12 text-[13px] text-muted-foreground">
              <button type="button" onClick={() => props.onNewProject(section.id)} className="inline-flex items-center gap-1.5 hover:text-foreground">
                <Plus className="size-4" /> Add a project
              </button>
            </td>
          </tr>
        )}
      </tbody>
      {open && s.visibleProjects.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[verticalOnly]} accessibility={tableDndA11y}>
          <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
            {s.visibleProjects.map((p, i) => (
              <ProjectGroup
                key={p.project.id}
                {...props}
                p={p}
                canMoveUp={i > 0}
                canMoveDown={i < visibleIds.length - 1}
                onMove={(dir) => reorderProjects(arrayMove(visibleIds, i, i + dir))}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}
    </>
  );
}

function SectionMenu({ s, index, sectionCount, onMoveSection, onEditSection, onDeleteSection, onNewProject }: Props & { s: VisibleSection; index: number; onMoveSection: (dir: -1 | 1) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted" aria-label={`Actions for section ${s.section.name}`}>
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={() => onNewProject(s.section.id)}>
          <Plus /> New project
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onEditSection(s.section)}>
          <Pencil /> Rename / edit
        </DropdownMenuItem>
        <DropdownMenuItem disabled={index <= 0} onSelect={() => onMoveSection(-1)}>
          <ArrowUp /> Move up
        </DropdownMenuItem>
        <DropdownMenuItem disabled={index === sectionCount - 1} onSelect={() => onMoveSection(1)}>
          <ArrowDown /> Move down
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => onDeleteSection(s.section)}>
          <Trash2 /> Delete section
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProjectGroup(props: Props & { p: VisibleProject; cutAt: CutAt; canMoveUp: boolean; canMoveDown: boolean; onMove: (dir: -1 | 1) => void }) {
  const { p, isOpen, onToggle, cutAt, ledger, sprint } = props;
  const store = useStore();
  const ui = useUi();
  const project = p.project;
  const open = isOpen(project.id, projectOpenByDefault(p));
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: project.id });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const visibleIds = p.visibleTasks.map((t) => t.ticket.id);
  const reorder = (ids: ID[]) => report(store.reorderTickets(project.id, mergeVisibleOrder(p.tasks.map((t) => t.ticket.id), ids)));
  const handleDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    reorder(arrayMove(visibleIds, visibleIds.indexOf(String(e.active.id)), visibleIds.indexOf(String(e.over.id))));
  };

  const n = p.tasks.length;
  const meta = [project.owner || null, project.targetDate ? `target ${format(parseISO(project.targetDate), 'd MMM')}` : 'no target', `${n} task${n === 1 ? '' : 's'}`]
    .filter(Boolean)
    .join(' · ');

  return (
    <tbody ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn(isDragging && 'relative z-20 bg-surface shadow-pop')} data-testid="ledger-project">
      <tr className="group/project border-t bg-muted/50">
        <th scope="rowgroup" colSpan={5} className="py-0 pl-2 pr-5 text-left font-normal">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <button
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              aria-label={`Reorder project ${project.name}. Press space to pick up, arrow keys to move.`}
              className="flex h-7 w-4 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/project:opacity-100 active:cursor-grabbing"
            >
              <GripVertical className="size-3.5" />
            </button>
            <button type="button" onClick={() => onToggle(project.id, !open)} aria-expanded={open} className="-ml-1.5 flex min-h-11 items-center gap-2 rounded-md px-1.5 text-left text-[14.5px] font-semibold">
              <ChevronRight className={cn('size-4 shrink-0 transition-transform', open && 'rotate-90')} />
              {project.name}
            </button>
            <span className="text-[12.5px] text-muted-foreground">{meta}</span>
            {p.excluded && (
              <Tooltip content="Only active projects are ranked. Their tasks don’t count toward the line.">
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11.5px] font-semibold text-foreground/70">{PROJECT_LIFECYCLE_LABEL[project.lifecycle]} · not ranked</span>
              </Tooltip>
            )}
            <span className="ml-auto font-mono text-[12.5px] font-bold text-foreground/75">{p.excluded ? '—' : totalLabel(p.abovePoints, p.belowPoints)}</span>
            <Tooltip content="Add task">
              <button
                type="button"
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={`Add task to ${project.name}`}
                onClick={() => {
                  onToggle(project.id, true);
                  ui.newTicket(project.id);
                }}
              >
                <Plus className="size-4" />
              </button>
            </Tooltip>
            <ProjectMenu {...props} />
          </div>
        </th>
      </tr>
      {typeof cutAt === 'object' && cutAt && 'afterProject' in cutAt && cutAt.afterProject === project.id && <CutRow ledger={ledger} />}
      {open && (
        <>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[verticalOnly]} accessibility={tableDndA11y}>
            <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
              {p.visibleTasks.map((t, i) => (
                <React.Fragment key={t.ticket.id}>
                  {typeof cutAt === 'object' && cutAt && 'before' in cutAt && cutAt.before === t.ticket.id && <CutRow ledger={ledger} />}
                  <TaskRow
                    task={t}
                    sprint={sprint}
                    teamCapacity={ledger.teamCapacity}
                    canMoveUp={i > 0}
                    canMoveDown={i < visibleIds.length - 1}
                    onMove={(dir) => reorder(arrayMove(visibleIds, i, i + dir))}
                  />
                </React.Fragment>
              ))}
            </SortableContext>
          </DndContext>
          {p.tasks.length > 0 && p.visibleTasks.length === 0 && (
            <tr className="border-t border-border/50">
              <td colSpan={5} className="py-2 pl-12 text-[12.5px] text-muted-foreground">
                No tasks match the current filters.
              </td>
            </tr>
          )}
          <tr className="border-t border-border/50">
            <td colSpan={5} className="p-0 [&>div]:pl-12">
              <QuickAddTicket project={project} planningSprintId={sprint.id} />
            </td>
          </tr>
        </>
      )}
    </tbody>
  );
}

function ProjectMenu({ p, canMoveUp, canMoveDown, onMove, onEditProject }: Props & { p: VisibleProject; canMoveUp: boolean; canMoveDown: boolean; onMove: (dir: -1 | 1) => void }) {
  const data = useData();
  const store = useStore();
  const project = p.project;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted" aria-label={`Actions for project ${project.name}`}>
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={() => onEditProject(project)}>
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
        {project.lifecycle === 'active' ? (
          <DropdownMenuItem onSelect={() => report(store.updateProject(project.id, { lifecycle: 'on_hold' }), `${project.name} is on hold and no longer ranked`)}>
            <Pause /> Put on hold
          </DropdownMenuItem>
        ) : (
          project.lifecycle !== 'archived' && (
            <DropdownMenuItem onSelect={() => report(store.updateProject(project.id, { lifecycle: 'active' }), `${project.name} is active and ranked again`)}>
              <Play /> Make active
            </DropdownMenuItem>
          )
        )}
        {project.lifecycle === 'archived' ? (
          <DropdownMenuItem onSelect={() => report(store.updateProject(project.id, { lifecycle: 'active' }), 'Project restored')}>
            <ArchiveRestore /> Unarchive
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => report(store.updateProject(project.id, { lifecycle: 'archived' }), 'Project archived — find it under Archived in the sidebar')}>
            <Archive /> Archive
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TaskRow({
  task,
  sprint,
  teamCapacity,
  canMoveUp,
  canMoveDown,
  onMove,
}: {
  task: LedgerTask;
  sprint: Sprint;
  teamCapacity: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (dir: -1 | 1) => void;
}) {
  const data = useData();
  const ui = useUi();
  const { ticket, state, rank, cumulative } = task;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: ticket.id });
  const inSprint = ticket.sprintId === sprint.id;
  const dim = state === 'below' || state === 'excluded' || state === 'elsewhere';
  const otherSprint = state === 'elsewhere' ? data.sprints.find((s) => s.id === ticket.sprintId) : undefined;
  const missing = [task.missingOwner && 'an owner', task.missingPoints && 'SP'].filter(Boolean).join(' or ');

  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'group/row border-t border-border/50 transition-colors',
        inSprint ? 'bg-indigo-50/40 hover:bg-indigo-50/70 dark:bg-indigo-500/[0.06] dark:hover:bg-indigo-500/10' : 'hover:bg-muted/40',
        isDragging && 'relative z-10 bg-surface shadow-pop',
      )}
      data-testid="ledger-task"
      data-ticket-key={ticket.key}
      data-state={state}
    >
      <td className="py-2 pl-1.5 pr-2">
        <div className="flex items-center gap-2">
          <button
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Reorder ${ticket.key}. Press space to pick up, arrow keys to move.`}
            className="flex h-6 w-3.5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100 active:cursor-grabbing"
          >
            <GripVertical className="size-3.5" />
          </button>
          <SprintToggle ticket={ticket} planningSprintId={sprint.id} />
          <span className="font-mono text-[12px] text-muted-foreground tabular">{rank === null ? '—' : String(rank).padStart(2, '0')}</span>
        </div>
      </td>
      <td className="py-2 pl-4 pr-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="shrink-0 font-mono text-[12px] text-muted-foreground">{ticket.key}</span>
          <button
            type="button"
            onClick={() => ui.openTicket(ticket.id)}
            title={ticket.title}
            className={cn('min-w-0 truncate text-left font-medium hover:underline focus-visible:underline', dim ? 'text-muted-foreground' : 'text-foreground')}
          >
            {ticket.title}
          </button>
          {state === 'incomplete' && (
            <Tooltip content={`Needs ${missing} before it counts toward capacity.`}>
              <span className="shrink-0 rounded-full border border-flag-line px-[7px] py-px text-[11.5px] font-semibold text-flag">Not counted</span>
            </Tooltip>
          )}
          {otherSprint && (
            <Pill dot="bg-violet-500" className="h-5 text-[11.5px]">
              {otherSprint.name}
            </Pill>
          )}
          <TicketActions
            ticket={ticket}
            planningSprintId={sprint.id}
            onMove={onMove}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            triggerClassName="ml-auto shrink-0 opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100"
          />
        </div>
      </td>
      <td className="px-2 py-1.5">
        <AssigneePicker ticket={ticket} variant="ledger" />
      </td>
      <td className="px-2 py-1.5 text-center">
        <PointsInput
          ticket={ticket}
          className={cn(
            'h-7 w-11 rounded-md border-transparent font-mono text-[13px] font-bold',
            ticket.points === null
              ? 'border-flag-line bg-flag-bg text-flag placeholder:text-flag/70'
              : state === 'counted'
                ? 'bg-cut text-cut-ink hover:border-cut-strong/40'
                : 'bg-muted text-foreground/75',
          )}
        />
      </td>
      <td className="py-2 pl-2 pr-5">
        <div className="flex items-center gap-2.5">
          <span className="w-9 shrink-0 text-right font-mono text-[12.5px] font-medium text-foreground/75 tabular">{cumulative === null ? '—' : formatPoints(cumulative)}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
            {cumulative !== null && teamCapacity > 0 && <div className="h-full rounded-full bg-cut" style={{ width: `${Math.min(100, (cumulative / teamCapacity) * 100)}%` }} />}
          </div>
        </div>
      </td>
    </tr>
  );
}

function CutRow({ ledger }: { ledger: CutLineLedger }) {
  if (!ledger.cut) return null;
  return (
    <tr data-testid="cut-line">
      <td colSpan={5} className="p-0">
        <div role="note" aria-label="Cut line" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-y-2 border-cut bg-cut-bg px-5 py-2.5">
          <Scissors className="size-4 shrink-0 text-cut-strong" aria-hidden />
          <span className="font-mono text-[12px] font-bold tracking-[0.08em] text-cut-strong">
            CUT LINE · {formatPoints(ledger.abovePoints)} / {formatPoints(ledger.teamCapacity)} SP
          </span>
          <span className="text-[13px] text-cut-text">{describeCutReason(ledger.cut.reason)}</span>
          <span className="ml-auto text-[12px] text-cut-text">Rows below stay where they are until you tick them in</span>
        </div>
      </td>
    </tr>
  );
}
