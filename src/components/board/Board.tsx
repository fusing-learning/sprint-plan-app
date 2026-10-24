import * as React from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ChevronsDownUp, ChevronsUpDown, Layers, Plus, SearchX } from 'lucide-react';
import type { Project, Section } from '@/domain/types';
import { report, useData, useStore, useUi, usePlanningSprint } from '@/state/react';
import { groupProjects, groupTickets, hasActiveFilters, isOnBoard, matchesSearch, sortedSections, sprintPoints, ticketMatches } from '@/state/selectors';
import { arrayMove } from '@/lib/utils';
import { Button } from '../ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { DeleteSectionDialog, SectionDialog } from '../dialogs/SectionDialogs';
import { ProjectDialog } from '../dialogs/ProjectDialog';
import { SectionBlock } from './SectionBlock';
import { verticalOnly } from './dnd';
import { FilterBar, useClearFilters } from './FilterBar';

export function Board() {
  const data = useData();
  const store = useStore();
  const ui = useUi();
  const planning = usePlanningSprint();
  const { filters, search } = ui;
  const [sectionDialog, setSectionDialog] = React.useState<{ section: Section | null } | null>(null);
  const [deleteSection, setDeleteSection] = React.useState<Section | null>(null);
  const [projectDialog, setProjectDialog] = React.useState<{ project: Project | null; sectionId?: string } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const sections = sortedSections(data);
  const projectsBySection = React.useMemo(() => groupProjects(data), [data]);
  const closedSprintIds = React.useMemo(() => new Set(data.sprints.filter((s) => s.status === 'closed').map((s) => s.id)), [data.sprints]);
  const ticketsByProject = React.useMemo(() => {
    const map = groupTickets(data);
    for (const [k, list] of map) map.set(k, list.filter((t) => isOnBoard(t, closedSprintIds)));
    return map;
  }, [data, closedSprintIds]);
  const filtersActive = hasActiveFilters(filters, search);
  const query = search.trim().toLowerCase();
  const onlySearch = !!query && filters.scope === 'all' && filters.assignee === 'all' && filters.gap === 'none';

  const view = sections.map((section) => {
    const all = projectsBySection.get(section.id) ?? [];
    const visible = all
      .filter((p) => (filters.showArchived ? p.lifecycle === 'archived' : p.lifecycle !== 'archived'))
      .map((project) => {
        const allTickets = ticketsByProject.get(project.id) ?? [];
        const projectMatched = !!query && matchesSearch(`${project.name} ${project.description} ${project.owner}`, query);
        const visibleTickets = allTickets.filter((t) => ticketMatches(t, filters, query, planning?.id ?? null, projectMatched));
        const show = !filtersActive || visibleTickets.length > 0 || (projectMatched && onlySearch);
        return { project, allTickets, visibleTickets, show };
      })
      .filter((v) => v.show);
    const sectionTickets = all.flatMap((p) => ticketsByProject.get(p.id) ?? []);
    return { section, all, visible, planned: sprintPoints(sectionTickets, planning?.id ?? null) };
  });
  const shownSections = filtersActive || filters.showArchived ? view.filter((v) => v.visible.length > 0) : view;

  // When a filter or search changes, open the projects and sections that have matches — once.
  // Afterwards they stay fully collapsible.
  const filterKey = JSON.stringify([filters.scope, filters.assignee, filters.gap, query, filters.showArchived]);
  React.useEffect(() => {
    if (!filtersActive) return;
    const matching = view.flatMap((v) => v.visible.filter((p) => p.visibleTickets.length > 0).map((p) => p.project.id));
    ui.setExpandedMany(matching, true);
    ui.setSectionsCollapsed(
      view.filter((v) => v.visible.length > 0).map((v) => v.section.id),
      false,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  const reorderSections = (ids: string[]) => report(store.reorderSections(ids));
  const handleDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = sections.map((s) => s.id);
    reorderSections(arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))));
  };

  const sectionIds = sections.map((s) => s.id);
  const projectIds = data.projects.map((p) => p.id);
  const clearAll = useClearFilters();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FilterBar>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="text-muted-foreground" aria-label="Expand or collapse">
              <ChevronsUpDown /> <span className="hidden sm:inline">Expand</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>Sections</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => ui.setSectionsCollapsed(sectionIds, false)}>
              <ChevronsUpDown /> Expand all sections
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => ui.setSectionsCollapsed(sectionIds, true)}>
              <ChevronsDownUp /> Collapse all sections
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Projects</DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={() => {
                ui.setSectionsCollapsed(sectionIds, false);
                ui.setExpandedMany(projectIds, true);
              }}
            >
              <ChevronsUpDown /> Expand all projects
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => ui.setExpandedMany(projectIds, false)}>
              <ChevronsDownUp /> Collapse all projects
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setSectionDialog({ section: null })}>
          <Layers /> <span className="hidden sm:inline">Section</span>
        </Button>
        <Button size="sm" onClick={() => setProjectDialog({ project: null, sectionId: sections[0]?.id })} disabled={!sections.length}>
          <Plus /> New project
        </Button>
      </FilterBar>

      {/* Board */}
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin" data-testid="board-scroll">
        {sections.length === 0 ? (
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
        ) : shownSections.length === 0 ? (
          <EmptyState
            icon={<SearchX className="size-5" />}
            title={filters.showArchived && !filtersActive ? 'No archived projects' : 'Nothing matches'}
            body={filters.showArchived && !filtersActive ? 'Archived projects will appear here.' : 'No tasks match the current search and filters.'}
            action={
              <Button variant="secondary" onClick={clearAll}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[verticalOnly]}>
            <SortableContext items={sectionIds} strategy={verticalListSortingStrategy}>
              <div className="pb-24">
                {data.projects.length === 0 && !filtersActive && (
                  <div className="flex items-center gap-3 border-b bg-indigo-50/40 dark:bg-indigo-500/5 px-4 py-3 text-[13px]">
                    <span className="font-medium">Start planning from the top.</span>
                    <span className="text-muted-foreground">Add a project to P0, then add tasks, an assignee and SP. Capacity on the right updates as you go.</span>
                  </div>
                )}
                {shownSections.map((v) => (
                  <SectionBlock
                    key={v.section.id}
                    section={v.section}
                    index={sections.indexOf(v.section)}
                    sectionCount={sections.length}
                    allProjects={v.all}
                    visibleProjects={v.visible}
                    plannedPoints={v.planned}
                    planningSprintName={planning?.name ?? null}
                    planningSprintId={planning?.id ?? null}
                    showArchived={filters.showArchived}
                    dragDisabled={filtersActive || filters.showArchived}
                    onEditSection={(section) => setSectionDialog({ section })}
                    onDeleteSection={setDeleteSection}
                    onMoveSection={(dir) => {
                      const i = sectionIds.indexOf(v.section.id);
                      reorderSections(arrayMove(sectionIds, i, i + dir));
                    }}
                    onNewProject={(sectionId) => setProjectDialog({ project: null, sectionId })}
                    onEditProject={(project) => setProjectDialog({ project })}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <SectionDialog open={!!sectionDialog} section={sectionDialog?.section ?? null} onOpenChange={(o) => !o && setSectionDialog(null)} />
      <DeleteSectionDialog section={deleteSection} onOpenChange={(o) => !o && setDeleteSection(null)} />
      <ProjectDialog
        open={!!projectDialog}
        project={projectDialog?.project ?? null}
        defaultSectionId={projectDialog?.sectionId}
        onOpenChange={(o) => !o && setProjectDialog(null)}
        onCreated={(p) => {
          ui.toggleExpanded(p.id, true);
          ui.toggleSection(p.sectionId, false);
        }}
      />
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">{icon}</div>
      <h3 className="text-[14px] font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
