import * as React from 'react';
import { CornerDownLeft, Plus } from 'lucide-react';
import type { Project } from '@/domain/types';
import { report, useData, useStore, useUi } from '@/state/react';
import { cn } from '@/lib/utils';
import { Kbd } from '../ui/misc';

export function QuickAddTicket({ project, planningSprintId }: { project: Project; planningSprintId: string | null }) {
  const store = useStore();
  const data = useData();
  const ui = useUi();
  const [title, setTitle] = React.useState('');
  const [focused, setFocused] = React.useState(false);
  const planning = data.sprints.find((s) => s.id === planningSprintId);
  const inputId = `quick-add-${project.id}`;

  const submit = () => {
    if (!title.trim()) return;
    // New tasks join the sprint being planned, or the backlog when that's what's on screen.
    const sprintId = ui.filters.scope === 'backlog' ? null : (planning?.id ?? null);
    const result = store.createTicket({ projectId: project.id, title, sprintId });
    if (report(result)) setTitle('');
  };

  return (
    <div className={cn('flex h-9 items-center gap-2.5 pl-3 pr-3 transition-colors sm:pl-9', focused ? 'bg-muted/60' : 'hover:bg-muted/40')}>
      <Plus className="size-4 shrink-0 text-muted-foreground/70" />
      <label htmlFor={inputId} className="sr-only">
        Add a task to {project.name}
      </label>
      <input
        id={inputId}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
          if (e.key === 'Escape') setTitle('');
        }}
        placeholder="Add a task…"
        className="h-7 min-w-0 flex-1 bg-transparent text-[13px] placeholder:text-muted-foreground/60 focus-visible:ring-0 focus-visible:ring-offset-0"
      />
      {title ? (
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
          <Kbd>
            <CornerDownLeft className="size-2.5" />
          </Kbd>
          to add
        </span>
      ) : (
        <button type="button" onClick={() => ui.newTicket(project.id)} className="shrink-0 rounded px-1.5 py-0.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground">
          Full form
        </button>
      )}
    </div>
  );
}
