import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, ChevronRight, ChevronsDownUp, ChevronsUpDown, GripVertical, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { formatPoints } from '@/domain/capacity';
import type { Project, Section, Ticket } from '@/domain/types';
import { report, useStore, useUi } from '@/state/react';
import { mergeVisibleOrder } from '@/state/selectors';
import { arrayMove, cn } from '@/lib/utils';
import { SECTION_COLORS, SectionGlyph } from '../meta';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Tooltip } from '../ui/misc';
import { ProjectCard } from './ProjectCard';
import { verticalOnly } from './dnd';

interface Props {
  section: Section;
  index: number;
  sectionCount: number;
  allProjects: Project[];
  visibleProjects: { project: Project; allTickets: Ticket[]; visibleTickets: Ticket[] }[];
  plannedPoints: number;
  planningSprintName: string | null;
  planningSprintId: string | null;
  showArchived: boolean;
  onEditSection: (s: Section) => void;
  onDeleteSection: (s: Section) => void;
  onMoveSection: (direction: -1 | 1) => void;
  onNewProject: (sectionId: string) => void;
  onEditProject: (p: Project) => void;
  dragDisabled: boolean;
}

export function SectionBlock(props: Props) {
  const { section, index, sectionCount, allProjects, visibleProjects, plannedPoints, planningSprintName, planningSprintId } = props;
  const store = useStore();
  const ui = useUi();
  const collapsed = ui.collapsedSections.has(section.id);
  const color = SECTION_COLORS[section.color];
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: section.id, disabled: props.dragDisabled });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const visibleIds = visibleProjects.map((v) => v.project.id);
  const reorderProjects = (ids: string[]) => report(store.reorderProjects(section.id, mergeVisibleOrder(allProjects.map((p) => p.id), ids)));
  const handleDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    reorderProjects(arrayMove(visibleIds, visibleIds.indexOf(String(e.active.id)), visibleIds.indexOf(String(e.over.id))));
  };

  const activeProjectCount = allProjects.filter((p) => p.lifecycle !== 'archived').length;
  const allProjectsOpen = visibleIds.length > 0 && visibleIds.every((id) => ui.expanded.has(id));

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('scroll-mt-2', isDragging && 'relative z-30 opacity-90')}
      aria-labelledby={`section-title-${section.id}`}
      id={`section-${section.id}`}
      data-testid="section"
    >
      <header className={cn('group/section sticky top-0 z-[5] flex h-10 items-center gap-2 border-y border-border/60 pl-3 pr-3', color.soft)}>
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Reorder section ${section.name}`}
          tabIndex={props.dragDisabled ? -1 : 0}
          className={cn(
            'absolute -left-0.5 hidden h-6 w-3.5 cursor-grab items-center justify-center rounded text-slate-400 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/section:opacity-100 sm:flex',
            props.dragDisabled && 'pointer-events-none !opacity-0',
          )}
        >
          <GripVertical className="size-3.5" />
        </button>
        <button type="button" onClick={() => ui.toggleSection(section.id)} aria-expanded={!collapsed} className="flex min-w-0 items-center gap-2 text-left">
          <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', !collapsed && 'rotate-90')} />
          <SectionGlyph section={section} />
          <h2 id={`section-title-${section.id}`} className="truncate text-[13.5px] font-semibold">
            {section.name}
          </h2>
          <span className="text-[13px] text-muted-foreground tabular">{props.showArchived ? visibleProjects.length : activeProjectCount}</span>
        </button>
        {planningSprintName && (
          <Tooltip content={`SP allocated from this section in ${planningSprintName}`}>
            <span className={cn('ml-1 whitespace-nowrap text-[12px] font-medium tabular', plannedPoints > 0 ? color.text : 'text-muted-foreground')}>{formatPoints(plannedPoints)} SP</span>
          </Tooltip>
        )}
        <div className="ml-auto flex items-center opacity-70 transition-opacity group-hover/section:opacity-100">
          {visibleIds.length > 0 && !collapsed && (
            <Tooltip content={allProjectsOpen ? 'Collapse all projects in this section' : 'Expand all projects in this section'}>
              <button
                type="button"
                onClick={() => ui.setExpandedMany(visibleIds, !allProjectsOpen)}
                className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground"
                aria-label={allProjectsOpen ? `Collapse all projects in ${section.name}` : `Expand all projects in ${section.name}`}
              >
                {allProjectsOpen ? <ChevronsDownUp className="size-3.5" /> : <ChevronsUpDown className="size-3.5" />}
              </button>
            </Tooltip>
          )}
          <Tooltip content="New project in this section">
            <button
              type="button"
              onClick={() => props.onNewProject(section.id)}
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground"
              aria-label={`New project in ${section.name}`}
            >
              <Plus className="size-4" />
            </button>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground data-[state=open]:bg-black/5" aria-label={`Actions for section ${section.name}`}>
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={() => props.onEditSection(section)}>
                <Pencil /> Rename / edit
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === 0} onSelect={() => props.onMoveSection(-1)}>
                <ArrowUp /> Move up
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === sectionCount - 1} onSelect={() => props.onMoveSection(1)}>
                <ArrowDown /> Move down
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => props.onDeleteSection(section)}>
                <Trash2 /> Delete section
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {!collapsed && (
        <div className="py-1">
          {visibleProjects.length === 0 ? (
            <button
              type="button"
              onClick={() => props.onNewProject(section.id)}
              className="flex h-10 w-full items-center gap-2 pl-9 text-[13px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              <Plus className="size-4" />
              {props.showArchived ? 'No archived projects here' : 'Add a project'}
            </button>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[verticalOnly]}>
              <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
                {visibleProjects.map((v, i) => (
                  <ProjectCard
                    key={v.project.id}
                    project={v.project}
                    allTickets={v.allTickets}
                    visibleTickets={v.visibleTickets}
                    planningSprintId={planningSprintId}
                    onEdit={props.onEditProject}
                    canMoveUp={i > 0}
                    canMoveDown={i < visibleProjects.length - 1}
                    onMove={(dir) => reorderProjects(arrayMove(visibleIds, i, i + dir))}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </div>
      )}
    </section>
  );
}
