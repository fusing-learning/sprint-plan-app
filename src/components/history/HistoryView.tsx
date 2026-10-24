import { format, parseISO } from 'date-fns';
import { ArrowRight, CheckCircle2, History, Inbox, Lock } from 'lucide-react';
import { formatPoints } from '@/domain/capacity';
import type { SnapshotTicket, TicketOutcome } from '@/domain/types';
import { sortSprints, useData, useUi } from '@/state/react';
import { cn } from '@/lib/utils';
import { EmptyState } from '../board/Board';

const OUTCOME: Record<TicketOutcome, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  completed: { label: 'Done', className: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10', icon: CheckCircle2 },
  carried_forward: { label: 'Carried forward', className: 'text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-500/10', icon: ArrowRight },
  returned_to_backlog: { label: 'Returned to backlog', className: 'text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800', icon: Inbox },
};

export function HistoryView() {
  const data = useData();
  const ui = useUi();
  const closed = sortSprints(data.sprints.filter((s) => s.status === 'closed')).reverse();
  const sprint = closed.find((s) => s.id === ui.historySprintId) ?? closed[0];

  if (!sprint || !sprint.snapshot) {
    return <EmptyState icon={<History className="size-5" />} title="No sprint history yet" body="When you close the active sprint, a read-only snapshot of its planned and completed work appears here." />;
  }
  const snap = sprint.snapshot;
  const completion = snap.committedPoints ? Math.round((snap.completedPoints / snap.committedPoints) * 100) : 0;
  const byOutcome = (o: TicketOutcome) => snap.tickets.filter((t) => t.outcome === o);

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-5" data-testid="history-view">
      <div className="flex flex-wrap items-center gap-2">
        {closed.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => ui.setHistorySprintId(s.id)}
            className={cn(
              'rounded-md border px-2.5 py-1 text-[12.5px] font-medium transition-colors',
              s.id === sprint.id ? 'border-primary/40 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-800 dark:text-indigo-300' : 'bg-surface text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {s.name}
          </button>
        ))}
      </div>

      <div className="rounded-xl border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[18px] font-semibold tracking-tight">{snap.sprintName}</h2>
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300">
                <Lock className="size-3" /> Closed · read-only
              </span>
            </div>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              {format(parseISO(snap.startDate), 'd MMM')} – {format(parseISO(snap.endDate), 'd MMM yyyy')} · closed {format(parseISO(snap.closedAt), 'd MMM yyyy, HH:mm')}
            </p>
            {sprint.goal && <p className="mt-2 text-[13px]">Goal: {sprint.goal}</p>}
          </div>
          <div className="text-right">
            <div className="text-[28px] font-semibold leading-none tabular tracking-tight">{completion}%</div>
            <div className="text-[12px] text-muted-foreground">of committed points completed</div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="Team capacity" value={snap.totalCapacity} />
          <Metric label="Committed" value={snap.committedPoints} />
          <Metric label="Completed" value={snap.completedPoints} tone="good" />
          <Metric label="Incomplete" value={snap.incompletePoints} tone={snap.incompletePoints > 0 ? 'warn' : undefined} />
        </div>

        <h3 className="mb-2 mt-6 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Individual workloads</h3>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/50 text-[11.5px] text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Member</th>
                <th className="px-3 py-2 text-right font-medium">Capacity</th>
                <th className="px-3 py-2 text-right font-medium">Planned</th>
                <th className="px-3 py-2 text-right font-medium">Completed</th>
                <th className="w-[30%] px-3 py-2 text-left font-medium">Load</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {snap.members.map((m) => (
                <tr key={m.memberId}>
                  <td className="px-3 py-2 font-medium">
                    {m.name} <span className="font-normal text-muted-foreground">· {m.role}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular">{formatPoints(m.capacity)}</td>
                  <td className="px-3 py-2 text-right tabular">{formatPoints(m.planned)}</td>
                  <td className="px-3 py-2 text-right tabular">{formatPoints(m.completed)}</td>
                  <td className="px-3 py-2">
                    <div className="relative h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div className="absolute inset-y-0 left-0 rounded-full bg-indigo-300" style={{ width: `${m.capacity ? Math.min(100, (m.planned / m.capacity) * 100) : 0}%` }} />
                      <div className="absolute inset-y-0 left-0 rounded-full bg-emerald-500" style={{ width: `${m.capacity ? Math.min(100, (m.completed / m.capacity) * 100) : 0}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <TicketGroup title="Done" tickets={byOutcome('completed')} />
      <TicketGroup title="Not done — carried forward" tickets={byOutcome('carried_forward')} />
      <TicketGroup title="Not done — returned to backlog" tickets={byOutcome('returned_to_backlog')} />
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'warn' }) {
  return (
    <div className={cn('rounded-lg border p-3', tone === 'good' && 'border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/5', tone === 'warn' && 'border-amber-200 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/5')}>
      <div className="text-[11.5px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-[20px] font-semibold tabular tracking-tight">
        {formatPoints(value)} <span className="text-[12px] font-medium text-muted-foreground">SP</span>
      </div>
    </div>
  );
}

function TicketGroup({ title, tickets }: { title: string; tickets: SnapshotTicket[] }) {
  if (!tickets.length) return null;
  return (
    <div>
      <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title} <span className="font-normal">· {tickets.length}</span>
      </h3>
      <div className="overflow-hidden rounded-lg border bg-surface">
        {tickets.map((t) => {
          const o = OUTCOME[t.outcome];
          const Icon = o.icon;
          return (
            <div key={t.ticketId} className="flex h-10 items-center gap-2 border-t px-3 first:border-t-0">
              <span className="w-11 shrink-0 text-[12.5px] text-muted-foreground tabular">{t.key}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{t.title}</span>
              <span className="hidden truncate text-[12px] text-muted-foreground lg:inline">{t.projectName}</span>
              <span className="w-[92px] truncate text-[12px] text-muted-foreground">{t.assigneeName ?? 'Unassigned'}</span>
              <span className="w-[38px] text-right text-[12.5px] font-semibold tabular">{t.points === null ? '—' : `${formatPoints(t.points)}`}</span>
              <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium', o.className)}>
                <Icon className="size-3" />
                {t.outcome === 'carried_forward' && t.carriedToSprintName ? `→ ${t.carriedToSprintName}` : o.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
