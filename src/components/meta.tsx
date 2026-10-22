import * as React from 'react';
import type { Member, ProjectLifecycle, Section, SectionColor } from '@/domain/types';
import type { CapacityState } from '@/domain/capacity';
import { cn, initials } from '@/lib/utils';

export const SECTION_COLORS: Record<SectionColor, { dot: string; bar: string; soft: string; text: string; border: string }> = {
  rose: { dot: 'bg-rose-500', bar: 'bg-rose-500', soft: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-500' },
  indigo: { dot: 'bg-indigo-500', bar: 'bg-indigo-500', soft: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-500' },
  amber: { dot: 'bg-amber-500', bar: 'bg-amber-500', soft: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-500' },
  violet: { dot: 'bg-violet-500', bar: 'bg-violet-500', soft: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-500' },
  teal: { dot: 'bg-teal-500', bar: 'bg-teal-500', soft: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-500' },
  slate: { dot: 'bg-slate-500', bar: 'bg-slate-500', soft: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-500' },
  emerald: { dot: 'bg-emerald-500', bar: 'bg-emerald-500', soft: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-500' },
  sky: { dot: 'bg-sky-500', bar: 'bg-sky-500', soft: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-500' },
};

export const LIFECYCLE_DOT: Record<ProjectLifecycle, string> = {
  active: 'bg-emerald-500',
  on_hold: 'bg-amber-500',
  completed: 'bg-slate-400',
  archived: 'bg-slate-300',
};

export const CAPACITY_META: Record<CapacityState, { bar: string; label: string }> = {
  empty: { bar: 'bg-slate-300', label: 'No capacity' },
  ok: { bar: 'bg-primary', label: 'Available' },
  low: { bar: 'bg-amber-500', label: 'Low capacity' },
  full: { bar: 'bg-emerald-500', label: 'Fully allocated' },
  over: { bar: 'bg-red-500', label: 'Over capacity' },
};

const AVATAR_COLORS = [
  'bg-indigo-100 text-indigo-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-800',
  'bg-sky-100 text-sky-700',
  'bg-rose-100 text-rose-700',
  'bg-violet-100 text-violet-700',
  'bg-teal-100 text-teal-700',
];

export function Avatar({ member, size = 'sm', className }: { member: Member | null | undefined; size?: 'xs' | 'sm' | 'md'; className?: string }) {
  const dims = size === 'xs' ? 'size-[18px] text-[9px]' : size === 'md' ? 'size-7 text-[11px]' : 'size-[22px] text-[10px]';
  if (!member) {
    return <span className={cn('inline-flex shrink-0 rounded-full border border-dashed border-slate-300', dims, className)} aria-hidden />;
  }
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold', AVATAR_COLORS[member.order % AVATAR_COLORS.length], dims, className)} aria-hidden>
      {initials(member.name)}
    </span>
  );
}

/** Linear-style rounded pill with optional leading dot or icon. */
export const Pill = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement> & { dot?: string; icon?: React.ReactNode; tone?: 'default' | 'warn' | 'accent' | 'muted' }
>(({ dot, icon, tone = 'default', className, children, ...props }, ref) => (
  <span
    ref={ref}
    className={cn(
      'inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-[12px] font-medium [&_svg]:size-3.5',
      tone === 'default' && 'border-border bg-surface text-foreground/75',
      tone === 'muted' && 'border-transparent bg-muted text-muted-foreground',
      tone === 'warn' && 'border-orange-200 bg-orange-50 text-orange-700',
      tone === 'accent' && 'border-indigo-200 bg-indigo-50 text-indigo-700',
      className,
    )}
    {...props}
  >
    {dot && <span className={cn('size-2 rounded-full', dot)} aria-hidden />}
    {icon}
    {children}
  </span>
));
Pill.displayName = 'Pill';

/** Ring-and-dot glyph used for a priority section, coloured by the section. */
export function SectionGlyph({ section, className }: { section: Pick<Section, 'color'>; className?: string }) {
  const c = SECTION_COLORS[section.color];
  return (
    <span className={cn('inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border-[1.5px]', c.border, className)} aria-hidden>
      <span className={cn('size-1.5 rounded-full', c.dot)} />
    </span>
  );
}
