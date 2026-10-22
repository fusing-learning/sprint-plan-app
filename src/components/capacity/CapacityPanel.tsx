import { CalendarClock, Palmtree, Settings2, Users, X } from 'lucide-react';
import { consumesCapacity, formatPoints, roundPoints, summarizeSprintCapacity, type MemberCapacity } from '@/domain/capacity';
import type { Sprint, Ticket } from '@/domain/types';
import { useData, useUi, usePlanningSprint } from '@/state/react';
import { groupProjects, sortedSections } from '@/state/selectors';
import { cn } from '@/lib/utils';
import { Avatar, CAPACITY_META, SECTION_COLORS, SectionGlyph } from '../meta';
import { Button } from '../ui/button';
import { Segmented, Tooltip } from '../ui/misc';

export function CapacityPanel({ onEditSprint, onCreateSprint }: { onEditSprint: (s: Sprint) => void; onCreateSprint: () => void }) {
  const data = useData();
  const ui = useUi();
  const sprint = usePlanningSprint();

  if (!sprint) {
    return (
      <div className="flex flex-col items-center px-5 py-12 text-center">
        <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Users className="size-5" />
        </div>
        <h3 className="text-[13.5px] font-semibold">No sprint to plan</h3>
        <p className="mt-1 text-[12.5px] text-muted-foreground">Create a sprint to see each person’s capacity.</p>
        <Button size="sm" className="mt-4" onClick={onCreateSprint}>
          Create sprint
        </Button>
      </div>
    );
  }

  const summary = summarizeSprintCapacity(data, sprint);
  const isProjected = sprint.status === 'planned';
  const pct = summary.totalCapacity ? Math.min(100, (summary.totalUsed / summary.totalCapacity) * 100) : 0;
  const selected = summary.members.find((m) => m.member.id === ui.filters.assignee) ?? null;

  return (
    <div className="pb-6" data-testid="capacity-panel">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-5 pb-1 pt-4">
        <div className="min-w-0">
          <h2 className="text-[13.5px] font-semibold">{isProjected ? 'Projected capacity' : 'Capacity'}</h2>
          <p className="truncate text-[12px] text-muted-foreground">{sprint.name}</p>
        </div>
        <Tooltip content="Adjust capacity for leave">
          <Button variant="ghost" size="icon-sm" onClick={() => onEditSprint(sprint)} aria-label="Adjust sprint capacity">
            <Settings2 />
          </Button>
        </Tooltip>
      </div>
      {isProjected && (
        <p className="mx-5 mt-1 flex items-start gap-1.5 text-[12px] text-violet-700">
          <CalendarClock className="mt-0.5 size-3.5 shrink-0" />
          Future sprint. This doesn’t change active sprint capacity.
        </p>
      )}

      {/* Totals */}
      <div className="px-5 pt-4" data-testid="team-total">
        <div className="flex items-baseline justify-between">
          <div className="text-[26px] font-semibold leading-none tracking-tight tabular">
            {formatPoints(summary.totalUsed)}
            <span className="text-[14px] font-medium text-muted-foreground"> / {formatPoints(summary.totalCapacity)} SP</span>
          </div>
          <div className="text-right text-[12.5px] text-muted-foreground">
            <span className={cn('text-[15px] font-semibold tabular', summary.totalRemaining <= 0 ? 'text-emerald-600' : 'text-foreground')}>{formatPoints(summary.totalRemaining)}</span> left
          </div>
        </div>
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={summary.totalCapacity} aria-valuenow={summary.totalUsed} aria-label="Team allocation">
          <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1.5 text-[12px] text-muted-foreground">
          {summary.ticketCount} task{summary.ticketCount === 1 ? '' : 's'} in sprint
        </p>
      </div>

      {/* People */}
      <PanelHeading>People</PanelHeading>
      <ul className="px-2" aria-label="Capacity by member">
        {summary.members.map((m) => (
          <MemberRow key={m.member.id} m={m} active={selected?.member.id === m.member.id} onClick={() => ui.setFilters({ assignee: selected?.member.id === m.member.id ? 'all' : m.member.id })} />
        ))}
      </ul>

      {/* Incomplete planning */}
      {(summary.unassigned.count > 0 || summary.unestimated.count > 0) && (
        <>
          <PanelHeading>Incomplete planning</PanelHeading>
          <div className="space-y-0.5 px-2">
            {summary.unassigned.count > 0 && (
              <GapRow
                label={`${summary.unassigned.count} without assignee`}
                detail={summary.unassigned.points ? `${formatPoints(summary.unassigned.points)} SP not counted` : 'not counted'}
                active={ui.filters.gap === 'unassigned'}
                onClick={() => ui.setFilters({ gap: ui.filters.gap === 'unassigned' ? 'none' : 'unassigned', assignee: 'all' })}
              />
            )}
            {summary.unestimated.count > 0 && (
              <GapRow
                label={`${summary.unestimated.count} without SP`}
                detail="not counted"
                active={ui.filters.gap === 'unestimated'}
                onClick={() => ui.setFilters({ gap: ui.filters.gap === 'unestimated' ? 'none' : 'unestimated', assignee: 'all' })}
              />
            )}
          </div>
        </>
      )}

      {/* Allocation */}
      <Allocation sprint={sprint} member={selected} />
    </div>
  );
}

function PanelHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="px-5 pb-1.5 pt-5 text-[12px] font-medium text-muted-foreground">{children}</h3>;
}

function MemberRow({ m, active, onClick }: { m: MemberCapacity; active: boolean; onClick: () => void }) {
  const meta = CAPACITY_META[m.state];
  const usedPct = m.capacity ? Math.min(100, (m.used / m.capacity) * 100) : m.used > 0 ? 100 : 0;
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={cn('w-full rounded-md px-3 py-2 text-left transition-colors hover:bg-muted/70', active && 'bg-indigo-50 hover:bg-indigo-50')}
        data-testid="member-capacity"
        data-member={m.member.name}
      >
        <div className="flex items-center gap-2">
          <Avatar member={m.member} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{m.member.name}</span>
          {m.isReduced && (
            <Tooltip content={`Capacity reduced to ${formatPoints(m.capacity)} (default ${formatPoints(m.defaultCapacity)}) for this sprint`}>
              <Palmtree className="size-3.5 shrink-0 text-amber-600" aria-label="Reduced capacity" />
            </Tooltip>
          )}
          <span className="text-[12.5px] tabular text-muted-foreground" data-testid="member-used">
            <span className="font-semibold text-foreground">{formatPoints(m.used)}</span>/{formatPoints(m.capacity)}
          </span>
          <span
            className={cn(
              'w-[52px] text-right text-[12px] font-medium tabular',
              m.state === 'full' && 'text-emerald-600',
              m.state === 'low' && 'text-amber-600',
              m.state === 'over' && 'text-red-600',
              (m.state === 'ok' || m.state === 'empty') && 'text-muted-foreground',
            )}
            data-testid="member-remaining"
          >
            {m.state === 'full' ? 'Full' : m.state === 'over' ? `+${formatPoints(-m.remaining)} over` : `${formatPoints(m.remaining)} left`}
          </span>
        </div>
        <div
          className="ml-[30px] mt-1.5 h-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={m.capacity}
          aria-valuenow={m.used}
          aria-label={`${m.member.name}: ${formatPoints(m.used)} of ${formatPoints(m.capacity)} SP allocated, ${meta.label}`}
        >
          <div className={cn('h-full rounded-full transition-all duration-300', meta.bar)} style={{ width: `${usedPct}%` }} />
        </div>
      </button>
    </li>
  );
}

function GapRow({ label, detail, active, onClick }: { label: string; detail: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn('flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-muted/70', active && 'bg-orange-50 hover:bg-orange-50')}
    >
      <span className="size-2 rounded-full bg-orange-500" />
      <span className="font-medium">{label}</span>
      <span className="ml-auto text-[12px] text-muted-foreground">{detail}</span>
    </button>
  );
}

/** Where the sprint's SP goes — by priority section or by project; for the team or the selected person. */
function Allocation({ sprint, member }: { sprint: Sprint; member: MemberCapacity | null }) {
  const data = useData();
  const ui = useUi();
  const counted = data.tickets.filter((t) => consumesCapacity(t, sprint.id) && (!member || t.assigneeId === member.member.id));
  const total = roundPoints(counted.reduce((s, t) => s + (t.points ?? 0), 0));
  const sum = (list: Ticket[]) => roundPoints(list.reduce((s, t) => s + (t.points ?? 0), 0));

  const sections = sortedSections(data);
  const projectsBySection = groupProjects(data);
  const rows =
    ui.allocationView === 'priority'
      ? sections.map((section) => {
          const ids = new Set((projectsBySection.get(section.id) ?? []).map((p) => p.id));
          return { id: section.id, label: section.name, section, points: sum(counted.filter((t) => ids.has(t.projectId))) };
        })
      : sections.flatMap((section) =>
          (projectsBySection.get(section.id) ?? []).map((p) => ({ id: p.id, label: p.name, section, points: sum(counted.filter((t) => t.projectId === p.id)) })),
        );
  const shown = rows.filter((r) => r.points > 0);

  return (
    <div data-testid="allocation">
      <div className="flex items-center justify-between gap-2 px-5 pb-2 pt-5">
        <h3 className="text-[12px] font-medium text-muted-foreground">Allocation</h3>
        <Segmented
          size="sm"
          ariaLabel="Allocation grouping"
          value={ui.allocationView}
          onChange={ui.setAllocationView}
          options={[
            { value: 'priority', label: 'Priority' },
            { value: 'project', label: 'Project' },
          ]}
        />
      </div>
      <div className="px-5">
        {member ? (
          <div className="mb-2.5 flex items-center gap-2 rounded-md bg-indigo-50 px-2 py-1.5 text-[12.5px]">
            <Avatar member={member.member} size="xs" />
            <span className="font-medium">{member.member.name}</span>
            <span className="text-muted-foreground tabular">· {formatPoints(total)} SP</span>
            <button type="button" onClick={() => ui.setFilters({ assignee: 'all' })} className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-white hover:text-foreground" aria-label="Show whole team">
              <X className="size-3.5" />
            </button>
          </div>
        ) : (
          <p className="mb-2.5 text-[12px] text-muted-foreground">Whole team · {formatPoints(total)} SP. Select a person to see theirs.</p>
        )}

        {shown.length === 0 ? (
          <p className="py-2 text-[12.5px] text-muted-foreground">Nothing allocated yet.</p>
        ) : (
          <>
            <div className="mb-3 flex h-1.5 gap-0.5 overflow-hidden rounded-full">
              {shown.map((r) => (
                <div key={r.id} className={cn('h-full first:rounded-l-full last:rounded-r-full', SECTION_COLORS[r.section.color].bar)} style={{ width: `${(r.points / Math.max(total, 0.01)) * 100}%` }} />
              ))}
            </div>
            <ul className="space-y-1.5">
              {shown.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-[12.5px]">
                  <SectionGlyph section={r.section} className="size-3" />
                  <span className="min-w-0 flex-1 truncate">{r.label}</span>
                  <span className="text-muted-foreground tabular">{Math.round((r.points / Math.max(total, 0.01)) * 100)}%</span>
                  <span className="w-10 text-right font-medium tabular">{formatPoints(r.points)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
