import * as React from 'react';
import { format, parseISO } from 'date-fns';
import { AlertTriangle, ChevronRight, Copy, Inbox, Trash2 } from 'lucide-react';
import { describeConflict, findCapacityConflict, formatPoints, memberAllocation, memberCapacityFor, parsePoints } from '@/domain/capacity';
import type { Ticket } from '@/domain/types';
import { report, sortSprints, useData, useStore, useUi } from '@/state/react';
import { groupProjects, sortedMembers, sortedSections } from '@/state/selectors';
import { cn } from '@/lib/utils';
import { Avatar, SectionGlyph } from '../meta';
import { Button } from '../ui/button';
import { useConfirm } from '../ui/confirm';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { Input, Label, Textarea } from '../ui/input';
import { Kbd } from '../ui/misc';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '../ui/select';

const NONE = '__none';

function blankTicket(projectId: string, key: string): Ticket {
  const ts = new Date().toISOString();
  return { id: '__draft', key, title: '', description: '', projectId, assigneeId: null, points: null, sprintId: null, order: 0, external: {}, createdAt: ts, updatedAt: ts };
}

export function TicketDialog() {
  const ui = useUi();
  const data = useData();
  const state = ui.ticketDialog;
  const existing = state?.mode === 'edit' ? data.tickets.find((t) => t.id === state.ticketId) : undefined;
  const open = !!state && (state.mode === 'create' || !!existing);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && ui.closeTicketDialog()}>
      <DialogContent className="max-w-[760px]" aria-describedby={undefined}>
        {open && (
          <TicketForm
            key={existing?.id ?? `new-${state?.mode === 'create' ? state.projectId : ''}`}
            existing={existing}
            createProjectId={state?.mode === 'create' ? state.projectId : undefined}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TicketForm({ existing, createProjectId }: { existing?: Ticket; createProjectId?: string }) {
  const data = useData();
  const store = useStore();
  const ui = useUi();
  const confirm = useConfirm();
  const [draft, setDraft] = React.useState<Ticket>(() => existing ?? blankTicket(createProjectId!, `${data.meta.ticketKeyPrefix}-${data.meta.nextTicketNumber}`));
  const [pointsText, setPointsText] = React.useState(existing?.points != null ? formatPoints(existing.points) : '');
  const [error, setError] = React.useState<string | null>(null);
  const isNew = !existing;
  const set = <K extends keyof Ticket>(k: K, v: Ticket[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setError(null);
  };

  const members = sortedMembers(data);
  const sections = sortedSections(data);
  const projectsBySection = groupProjects(data);
  const openSprints = sortSprints(data.sprints.filter((s) => s.status !== 'closed'));
  const currentSprint = draft.sprintId ? data.sprints.find((s) => s.id === draft.sprintId) : undefined;
  const isClosedSprint = currentSprint?.status === 'closed';
  const project = data.projects.find((p) => p.id === draft.projectId);
  const section = project ? data.sections.find((s) => s.id === project.sectionId) : undefined;

  const parsedPoints = parsePoints(pointsText);
  const effective: Ticket = { ...draft, points: parsedPoints.ok ? parsedPoints.value : draft.points };
  const conflict = findCapacityConflict(data, effective);
  const assignee = members.find((m) => m.id === draft.assigneeId);
  const capacityPreview =
    currentSprint && !isClosedSprint && assignee
      ? (() => {
          const cap = memberCapacityFor(currentSprint, assignee);
          const before = memberAllocation(data.tickets, currentSprint.id, assignee.id, draft.id);
          return { cap, after: before + (effective.points ?? 0) };
        })()
      : null;

  const save = () => {
    if (!parsedPoints.ok) {
      setError(parsedPoints.error);
      return;
    }
    const patch = {
      title: draft.title,
      description: draft.description,
      projectId: draft.projectId,
      assigneeId: draft.assigneeId,
      points: parsedPoints.value,
      sprintId: draft.sprintId,
    };
    const result = existing ? store.updateTicket(existing.id, patch) : store.createTicket(patch);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    report(result, existing ? 'Task saved' : `${result.value.key} created`);
    ui.closeTicketDialog();
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await confirm({ title: `Delete ${existing.key}?`, description: `“${existing.title}” will be permanently deleted.`, confirmLabel: 'Delete task', destructive: true });
    if (ok && report(store.deleteTicket(existing.id), 'Task deleted')) ui.closeTicketDialog();
  };

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          save();
        }
      }}
    >
      <div className="flex items-center gap-1.5 border-b px-5 py-3 pr-12 text-[12.5px] text-muted-foreground">
        {section && <SectionGlyph section={section} className="size-3" />}
        <span className="truncate">{section?.name}</span>
        <ChevronRight className="size-3.5" />
        <span className="truncate font-medium text-foreground">{project?.name}</span>
        <ChevronRight className="size-3.5" />
        <span className="tabular">{isNew ? `${draft.key} (new)` : draft.key}</span>
        <DialogTitle className="sr-only">{isNew ? 'New task' : `Edit ${draft.key}`}</DialogTitle>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto scrollbar-thin md:grid-cols-[1fr_250px]">
        <div className="space-y-3 px-5 py-4">
          <label htmlFor="ticket-title" className="sr-only">
            Title
          </label>
          <textarea
            id="ticket-title"
            value={draft.title}
            onChange={(e) => set('title', e.target.value.replace(/\n/g, ' '))}
            placeholder="Task title"
            rows={1}
            autoFocus={isNew}
            className="w-full resize-none bg-transparent text-[18px] font-semibold leading-snug tracking-tight placeholder:font-normal placeholder:text-muted-foreground/60 focus-visible:ring-0 focus-visible:ring-offset-0 [field-sizing:content]"
          />
          <label htmlFor="ticket-desc" className="sr-only">
            Description
          </label>
          <Textarea
            id="ticket-desc"
            value={draft.description}
            onChange={(e) => set('description', e.target.value)}
            rows={8}
            placeholder="Add a description — scope, open questions, links…"
            className="border-transparent px-0 shadow-none focus-visible:border-transparent focus-visible:ring-0"
          />
        </div>

        <aside className="space-y-3.5 border-t bg-muted/40 px-4 py-4 md:border-l md:border-t-0">
          <PropRow label="Sprint">
            {isClosedSprint ? (
              <div className="flex h-8 items-center rounded-md border bg-muted px-2.5 text-[13px] text-muted-foreground">{currentSprint!.name} (closed)</div>
            ) : (
              <Select value={draft.sprintId ?? NONE} onValueChange={(v) => set('sprintId', v === NONE ? null : v)}>
                <SelectTrigger aria-label="Sprint" className={cn(draft.sprintId && 'border-primary/40 bg-indigo-50/60')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>
                    <span className="inline-flex items-center gap-2">
                      <Inbox className="size-3.5 text-muted-foreground" /> Backlog
                    </span>
                  </SelectItem>
                  {openSprints.length > 0 && <SelectSeparator />}
                  {openSprints.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} · {s.status === 'active' ? 'Active' : 'Planned'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </PropRow>
          <PropRow label="Assignee">
            <Select value={draft.assigneeId ?? NONE} onValueChange={(v) => set('assigneeId', v === NONE ? null : v)}>
              <SelectTrigger aria-label="Assignee">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>
                  <span className="inline-flex items-center gap-2">
                    <Avatar member={null} size="xs" /> Unassigned
                  </span>
                </SelectItem>
                {members.map((m) => {
                  const remaining = currentSprint && !isClosedSprint ? memberCapacityFor(currentSprint, m) - memberAllocation(data.tickets, currentSprint.id, m.id, draft.id) : null;
                  return (
                    <SelectItem key={m.id} value={m.id}>
                      <span className="inline-flex items-center gap-2">
                        <Avatar member={m} size="xs" /> {m.name}
                        {remaining !== null && <span className="text-[11px] text-muted-foreground">· {formatPoints(remaining)} SP left</span>}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </PropRow>
          <PropRow label="Story points">
            <Input
              value={pointsText}
              onChange={(e) => {
                setPointsText(e.target.value);
                setError(null);
              }}
              inputMode="decimal"
              placeholder="e.g. 3 — empty if unestimated"
              aria-label="Story points"
              className={cn('tabular', !parsedPoints.ok && 'border-red-400')}
            />
            {!parsedPoints.ok && <p className="text-[11.5px] text-red-600">{parsedPoints.error}</p>}
          </PropRow>

          {capacityPreview && (
            <div className={cn('rounded-lg border p-2.5 text-[12px]', conflict ? 'border-red-200 bg-red-50 text-red-800' : 'border-indigo-100 bg-indigo-50/70 text-indigo-900')}>
              <div className="flex items-center justify-between font-medium">
                <span className="truncate">
                  {assignee!.name} · {currentSprint!.name}
                </span>
                <span className="tabular">
                  {formatPoints(capacityPreview.after)} / {formatPoints(capacityPreview.cap)}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/80">
                <div
                  className={cn('h-full rounded-full transition-all', conflict ? 'bg-red-500' : capacityPreview.after === capacityPreview.cap ? 'bg-emerald-500' : 'bg-primary')}
                  style={{ width: `${Math.min(100, capacityPreview.cap ? (capacityPreview.after / capacityPreview.cap) * 100 : 100)}%` }}
                />
              </div>
              <p className="mt-1.5">{conflict ? describeConflict(conflict) : `${formatPoints(capacityPreview.cap - capacityPreview.after)} SP will remain.`}</p>
            </div>
          )}
          {currentSprint && !isClosedSprint && (!draft.assigneeId || effective.points === null) && (
            <p className="flex items-start gap-1.5 rounded-md bg-orange-50 p-2 text-[12px] text-orange-800">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              Needs {!draft.assigneeId && effective.points === null ? 'an assignee and SP' : !draft.assigneeId ? 'an assignee' : 'SP'} to count toward capacity.
            </p>
          )}

          <PropRow label="Project">
            <Select value={draft.projectId} onValueChange={(v) => set('projectId', v)}>
              <SelectTrigger aria-label="Project">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sections.map((s) => {
                  const projects = (projectsBySection.get(s.id) ?? []).filter((p) => p.lifecycle !== 'archived' || p.id === draft.projectId);
                  if (!projects.length) return null;
                  return (
                    <SelectGroup key={s.id}>
                      <SelectLabel>{s.name}</SelectLabel>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  );
                })}
              </SelectContent>
            </Select>
          </PropRow>

          {existing && (
            <div className="space-y-0.5 border-t pt-3 text-[11px] text-muted-foreground">
              <div>Created {format(parseISO(existing.createdAt), 'd MMM yyyy, HH:mm')}</div>
              <div>Updated {format(parseISO(existing.updatedAt), 'd MMM yyyy, HH:mm')}</div>
            </div>
          )}
        </aside>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 border-t border-red-200 bg-red-50 px-5 py-2.5 text-[12.5px] text-red-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      )}
      <div className="flex items-center gap-2 border-t px-5 py-3">
        {existing && (
          <>
            <Button variant="destructive-ghost" size="sm" onClick={remove}>
              <Trash2 /> Delete
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const r = store.duplicateTicket(existing.id);
                if (report(r)) ui.openTicket(r.value.id);
              }}
            >
              <Copy /> Duplicate
            </Button>
          </>
        )}
        <span className="ml-auto hidden items-center gap-1 text-[11.5px] text-muted-foreground sm:flex">
          <Kbd>⌘</Kbd>
          <Kbd>↵</Kbd> to save
        </span>
        <Button variant="secondary" onClick={() => ui.closeTicketDialog()}>
          Cancel
        </Button>
        <Button type="submit" disabled={!draft.title.trim()}>
          {isNew ? 'Create task' : 'Save'}
        </Button>
      </div>
    </form>
  );
}

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
