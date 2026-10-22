import * as React from 'react';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { AlertTriangle, ArrowRight, Check, Inbox, Palmtree } from 'lucide-react';
import { clampCapacity, describeConflict, findCapacityConflict, formatPoints, memberAllocation, memberCapacityFor, roundPoints } from '@/domain/capacity';
import { carryAllDecisions, sprintEndFromStart, sprintTickets, suggestNextSprint, type CloseDecision } from '@/domain/sprints';
import { MAX_MEMBER_CAPACITY, type Sprint } from '@/domain/types';
import { report, sortSprints, useData, useStore, useUi } from '@/state/react';
import { sortedMembers } from '@/state/selectors';
import { cn } from '@/lib/utils';
import { Avatar } from '../meta';
import { Button } from '../ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Field, Input, Label } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

export function SprintDialog({ open, sprint, onOpenChange }: { open: boolean; sprint: Sprint | null; onOpenChange: (o: boolean) => void }) {
  const data = useData();
  const store = useStore();
  const ui = useUi();
  const members = sortedMembers(data);
  const [name, setName] = React.useState('');
  const [goal, setGoal] = React.useState('');
  const [startDate, setStart] = React.useState('');
  const [endDate, setEnd] = React.useState('');
  const [caps, setCaps] = React.useState<Record<string, number>>({});
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setError(null);
    if (sprint) {
      setName(sprint.name);
      setGoal(sprint.goal);
      setStart(sprint.startDate);
      setEnd(sprint.endDate);
      setCaps(Object.fromEntries(members.map((m) => [m.id, memberCapacityFor(sprint, m)])));
    } else {
      const s = suggestNextSprint(data.sprints);
      setName(s.name);
      setGoal('');
      setStart(s.startDate);
      setEnd(s.endDate);
      setCaps(Object.fromEntries(members.map((m) => [m.id, clampCapacity(m.defaultCapacity)])));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sprint?.id]);

  const total = roundPoints(Object.values(caps).reduce((s, n) => s + n, 0));
  const days = startDate && endDate ? differenceInCalendarDays(parseISO(endDate), parseISO(startDate)) + 1 : 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input = { name, goal, startDate, endDate, capacities: caps };
    const result = sprint ? store.updateSprint(sprint.id, input) : store.createSprint(input);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    report(result, sprint ? 'Sprint updated' : `${result.value.name} created`);
    if (!sprint) ui.setPlanningSprintId(result.value.id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>{sprint ? `Edit ${sprint.name}` : 'Create sprint'}</DialogTitle>
            <DialogDescription>Two-week sprints. Lower someone’s capacity for leave or other commitments (max 10 SP).</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4 pb-4">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Name" htmlFor="sprint-name">
                <Input id="sprint-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </Field>
              <Field label="Start date" htmlFor="sprint-start">
                <Input
                  id="sprint-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStart(e.target.value);
                    if (e.target.value) setEnd(sprintEndFromStart(e.target.value));
                  }}
                />
              </Field>
              <Field label="End date" htmlFor="sprint-end" hint={days > 0 ? `${days} days` : undefined}>
                <Input id="sprint-end" type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} />
              </Field>
            </div>
            <Field label="Sprint goal (optional)" htmlFor="sprint-goal">
              <Input id="sprint-goal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="What should this sprint achieve?" />
            </Field>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <Label>Capacity per person</Label>
                <span className="text-[12px] font-medium tabular text-muted-foreground">Team total {formatPoints(total)} SP</span>
              </div>
              <div className="divide-y rounded-lg border">
                {members.map((m) => {
                  const cap = caps[m.id] ?? 10;
                  const allocated = sprint ? memberAllocation(data.tickets, sprint.id, m.id) : 0;
                  const reduced = cap < clampCapacity(m.defaultCapacity);
                  return (
                    <div key={m.id} className="flex items-center gap-3 px-3 py-2">
                      <Avatar member={m} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium">{m.name}</div>
                        <div className="text-[11.5px] text-muted-foreground">
                          {sprint ? `${formatPoints(allocated)} SP already allocated` : m.role}
                          {reduced && (
                            <span className="ml-1.5 inline-flex items-center gap-0.5 text-amber-700">
                              <Palmtree className="size-3" /> reduced
                            </span>
                          )}
                        </div>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={MAX_MEMBER_CAPACITY}
                        step={0.5}
                        value={cap}
                        onChange={(e) => setCaps((c) => ({ ...c, [m.id]: Number(e.target.value) }))}
                        aria-label={`${m.name} capacity`}
                        className="w-28 accent-[hsl(var(--primary))]"
                      />
                      <Input
                        type="number"
                        min={0}
                        max={MAX_MEMBER_CAPACITY}
                        step="any"
                        value={cap}
                        onChange={(e) => setCaps((c) => ({ ...c, [m.id]: Math.min(MAX_MEMBER_CAPACITY, Math.max(0, Number(e.target.value) || 0)) }))}
                        aria-label={`${m.name} capacity in SP`}
                        className={cn('h-7 w-16 text-right tabular', allocated > cap && 'border-red-400 text-red-700')}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </DialogBody>
          {error && (
            <div role="alert" className="flex items-start gap-2 border-t border-red-200 bg-red-50 px-5 py-2.5 text-[12.5px] text-red-800">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {error}
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{sprint ? 'Save sprint' : 'Create sprint'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CloseSprintDialog({ sprint, onOpenChange }: { sprint: Sprint | null; onOpenChange: (o: boolean) => void }) {
  const data = useData();
  const store = useStore();
  const ui = useUi();
  const planned = sortSprints(data.sprints.filter((s) => s.status === 'planned'));
  const [target, setTarget] = React.useState<string>('');
  const [decisions, setDecisions] = React.useState<Record<string, CloseDecision>>({});
  const [activateNext, setActivateNext] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const tickets = sprint ? sprintTickets(data, sprint.id) : [];
  const decisionFor = (id: string): CloseDecision => decisions[id] ?? { type: 'done' };
  const doneTickets = tickets.filter((t) => decisionFor(t.id).type === 'done');
  const committed = roundPoints(tickets.reduce((s, t) => s + (t.points ?? 0), 0));
  const completed = roundPoints(doneTickets.reduce((s, t) => s + (t.points ?? 0), 0));
  const targetName = planned.find((s) => s.id === target)?.name;

  React.useEffect(() => {
    if (!sprint) return;
    const next = planned[0]?.id ?? '';
    setTarget(next);
    setDecisions({});
    setActivateNext(!!next);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprint?.id]);

  const projectName = (projectId: string) => data.projects.find((p) => p.id === projectId)?.name ?? '';
  const memberById = new Map(data.members.map((m) => [m.id, m]));

  const conflicts = React.useMemo(() => {
    let working = data.tickets;
    const out: string[] = [];
    for (const t of tickets) {
      const d = decisions[t.id];
      if (d?.type !== 'carry') continue;
      const moved = { ...t, sprintId: d.sprintId };
      const c = findCapacityConflict({ ...data, tickets: working }, moved);
      if (c) out.push(`${t.key}: ${describeConflict(c)}`);
      working = working.map((w) => (w.id === t.id ? moved : w));
    }
    return out;
  }, [data, decisions, tickets]);

  const setAll = (type: 'done' | 'backlog' | 'carry') => {
    if (!sprint) return;
    if (type === 'carry' && target) setDecisions(carryAllDecisions(data, sprint.id, target));
    else setDecisions(Object.fromEntries(tickets.map((t) => [t.id, { type } as CloseDecision])));
  };

  const confirmClose = () => {
    if (!sprint) return;
    const result = store.closeSprint(sprint.id, decisions, activateNext && target ? target : null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    report(result, `${sprint.name} closed`);
    if (activateNext && target) ui.setMode('active');
    ui.setHistorySprintId(sprint.id);
    onOpenChange(false);
  };

  return (
    <Dialog open={!!sprint} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Close {sprint?.name}</DialogTitle>
          <DialogDescription>Mark what got done. Unfinished tasks go back to the backlog or move to the next sprint. A read-only snapshot is saved to Sprint History.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4 pb-4">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Committed" value={`${formatPoints(committed)} SP`} sub={`${tickets.length} tasks`} />
            <Stat label="Done" value={`${formatPoints(completed)} SP`} sub={`${doneTickets.length} tasks`} tone="good" />
            <Stat label="Not done" value={`${formatPoints(roundPoints(committed - completed))} SP`} sub={`${tickets.length - doneTickets.length} tasks`} tone={tickets.length - doneTickets.length ? 'warn' : undefined} />
          </div>

          {tickets.length > 0 ? (
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <Label className="mr-auto">Tasks in this sprint</Label>
                {planned.length > 0 && (
                  <Select
                    value={target}
                    onValueChange={(v) => {
                      setTarget(v);
                      setDecisions((x) => Object.fromEntries(Object.entries(x).map(([k, d]) => [k, d.type === 'carry' ? { type: 'carry', sprintId: v } : d])));
                    }}
                  >
                    <SelectTrigger className="h-7 w-auto min-w-[120px] text-[12.5px]" aria-label="Carry forward target sprint">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {planned.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          Next: {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button size="xs" variant="secondary" onClick={() => setAll('done')}>
                  All done
                </Button>
                <Button size="xs" variant="secondary" onClick={() => setAll('backlog')}>
                  All to backlog
                </Button>
                <Button size="xs" variant="secondary" onClick={() => setAll('carry')} disabled={!target}>
                  Carry all
                </Button>
              </div>
              <div className="max-h-72 divide-y overflow-y-auto rounded-lg border scrollbar-thin">
                {tickets.map((t) => {
                  const d = decisionFor(t.id);
                  const opt = (type: CloseDecision['type'], label: React.ReactNode, disabled = false) => (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={d.type === type}
                      disabled={disabled}
                      onClick={() => setDecisions((x) => ({ ...x, [t.id]: type === 'carry' ? { type, sprintId: target } : { type } }))}
                      className={cn(
                        'inline-flex h-6 items-center gap-1 rounded px-2 text-[12px] font-medium disabled:opacity-40 [&_svg]:size-3',
                        d.type === type ? 'bg-surface shadow-sm' : 'text-muted-foreground hover:text-foreground',
                        d.type === type && type === 'done' && 'text-emerald-700',
                        d.type === type && type === 'carry' && 'text-primary',
                      )}
                    >
                      {label}
                    </button>
                  );
                  return (
                    <div key={t.id} className="flex items-center gap-2 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium">{t.title}</div>
                        <div className="truncate text-[11.5px] text-muted-foreground">
                          {t.key} · {projectName(t.projectId)} · {t.assigneeId ? memberById.get(t.assigneeId)?.name : 'Unassigned'} · {t.points === null ? 'no SP' : `${formatPoints(t.points)} SP`}
                        </div>
                      </div>
                      <div className="inline-flex shrink-0 rounded-md bg-muted p-0.5" role="radiogroup" aria-label={`Outcome for ${t.key}`}>
                        {opt(
                          'done',
                          <>
                            <Check /> Done
                          </>,
                        )}
                        {opt(
                          'backlog',
                          <>
                            <Inbox /> Backlog
                          </>,
                        )}
                        {opt(
                          'carry',
                          <>
                            <ArrowRight /> {targetName ?? 'Next'}
                          </>,
                          !target,
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {planned.length === 0 && <p className="mt-2 text-[12px] text-muted-foreground">No planned sprint exists yet, so unfinished work can only return to the backlog.</p>}
            </div>
          ) : (
            <p className="rounded-lg bg-muted p-3 text-[13px] text-muted-foreground">This sprint has no tasks.</p>
          )}

          {conflicts.length > 0 && (
            <div role="alert" className="space-y-1 rounded-lg border border-red-200 bg-red-50 p-3 text-[12.5px] text-red-800">
              <div className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="size-4" /> Carry-over exceeds capacity in the next sprint
              </div>
              {conflicts.map((c) => (
                <p key={c}>{c}</p>
              ))}
            </div>
          )}

          {target && (
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input type="checkbox" checked={activateNext} onChange={(e) => setActivateNext(e.target.checked)} className="size-4 accent-[hsl(var(--primary))]" />
              Make {targetName} the active sprint after closing
            </label>
          )}
        </DialogBody>
        {error && (
          <div role="alert" className="flex items-start gap-2 border-t border-red-200 bg-red-50 px-5 py-2.5 text-[12.5px] text-red-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {error}
          </div>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={confirmClose} disabled={conflicts.length > 0}>
            Close sprint
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'good' | 'warn' }) {
  return (
    <div className={cn('rounded-lg border p-3', tone === 'good' && 'border-emerald-200 bg-emerald-50/60', tone === 'warn' && 'border-amber-200 bg-amber-50/60')}>
      <div className="text-[11.5px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-[18px] font-semibold tabular tracking-tight">{value}</div>
      <div className="text-[11.5px] text-muted-foreground">{sub}</div>
    </div>
  );
}
