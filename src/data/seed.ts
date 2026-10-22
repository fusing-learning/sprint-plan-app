import { addDays, format, startOfWeek } from 'date-fns';
import { closeSprint, currentSprintStart, sprintEndFromStart } from '@/domain/sprints';
import {
  SCHEMA_VERSION,
  type AppData,
  type AppMeta,
  type Member,
  type Project,
  type ProjectLifecycle,
  type Section,
  type SectionColor,
  type Sprint,
  type Ticket,
} from '@/domain/types';
import { newId } from '@/lib/utils';

const d = (date: Date) => format(date, 'yyyy-MM-dd');

export const DEFAULT_SECTIONS: { name: string; description: string; color: SectionColor }[] = [
  {
    name: 'P0 — Executive Priority',
    description: 'Highest priority. Consider first. Usually 3–4 projects.',
    color: 'rose',
  },
  { name: 'Committed Deliverables', description: 'Non-P0 projects with delivery commitments.', color: 'indigo' },
  {
    name: 'Needs Clarification',
    description: 'Discovery, requirements or stakeholder alignment needed before build.',
    color: 'amber',
  },
  { name: 'Exploration / Pipeline', description: 'Early ideas, prototypes and unscheduled requirements.', color: 'violet' },
  { name: 'BAU / Maintenance', description: 'Support, improvements, defect fixes and operational work.', color: 'teal' },
];

export const DEFAULT_MEMBERS: { name: string; role: string }[] = [
  { name: 'PM', role: 'Product Manager' },
  { name: 'Engineer A', role: 'Engineer' },
  { name: 'Engineer B', role: 'Engineer' },
  { name: 'Engineer C', role: 'Engineer' },
];

function baseMeta(nextTicketNumber = 1): AppMeta {
  return { id: 'app', schemaVersion: SCHEMA_VERSION, initialized: true, nextTicketNumber, ticketKeyPrefix: 'SF' };
}

function makeMembers(ts: string): Member[] {
  return DEFAULT_MEMBERS.map((m, i) => ({
    id: newId('mem'),
    name: m.name,
    role: m.role,
    defaultCapacity: 10,
    order: i,
    createdAt: ts,
    updatedAt: ts,
  }));
}

function makeSections(ts: string): Section[] {
  return DEFAULT_SECTIONS.map((s, i) => ({ id: newId('sec'), ...s, order: i, createdAt: ts, updatedAt: ts }));
}

/** A fresh active sprint starting this Monday. */
export function makeStarterSprint(now: Date = new Date(), name = 'Sprint 1'): Sprint {
  const ts = now.toISOString();
  const startDate = currentSprintStart(now);
  return {
    id: newId('spr'),
    name,
    goal: '',
    startDate,
    endDate: sprintEndFromStart(startDate),
    status: 'active',
    capacities: {},
    snapshot: null,
    createdAt: ts,
    updatedAt: ts,
  };
}

/** Clean workspace: default team, default sections and one empty active sprint. */
export function createEmptyWorkspace(now: Date = new Date()): AppData {
  const ts = now.toISOString();
  return {
    meta: baseMeta(),
    members: makeMembers(ts),
    sections: makeSections(ts),
    projects: [],
    tickets: [],
    sprints: [makeStarterSprint(now)],
  };
}

interface TicketSeed {
  title: string;
  description?: string;
  who?: 0 | 1 | 2 | 3 | null;
  pts?: number | null;
  sprint?: 'prev' | 'active' | 'next' | 'later' | null;
}

interface ProjectSeed {
  section: number;
  name: string;
  description: string;
  owner?: string;
  lifecycle?: ProjectLifecycle;
  targetInDays?: number;
  tickets: TicketSeed[];
}

const PROJECTS: ProjectSeed[] = [
  {
    section: 0,
    name: 'Checkout Redesign',
    description: 'Rebuild the checkout as a single page to cut drop-off from 38% to under 25%.',
    owner: 'PM',
    targetInDays: 40,
    tickets: [
      {
        title: 'Run usability test on checkout wireframes',
        who: 0,
        pts: 2,
        sprint: 'prev',
        description: 'Five moderated sessions with recent buyers using the Figma prototype.',
      },
      {
        title: 'Implement single-page checkout layout',
        who: 1,
        pts: 3,
        sprint: 'prev',
        description: 'Combine shipping, payment and review into one responsive page behind the `checkout_v2` flag.',
      },
      {
        title: 'Integrate Apple Pay and Google Pay',
        who: 3,
        pts: 5,
        sprint: 'active',
        description: 'Add wallet buttons using the payment provider SDK. Domain verification needed for Apple Pay.',
      },
      {
        title: 'Add address autocomplete to shipping form',
        who: 2,
        pts: 2,
        sprint: 'active',
        description: 'Use the existing places API key; debounce lookups to 250ms.',
      },
      { title: 'Write checkout funnel analytics event spec', who: 0, pts: 1, sprint: 'active' },
      {
        title: 'Fix promo code validation on mobile Safari',
        who: null,
        pts: 2,
        sprint: 'active',
        description: 'Promo codes with trailing spaces are rejected on iOS 17 Safari.',
      },
      {
        title: 'Define guest checkout edge cases',
        who: 0,
        pts: null,
        sprint: null,
        description: 'Agree with Legal how guest orders are linked to accounts created later.',
      },
    ],
  },
  {
    section: 0,
    name: 'SSO for Enterprise Customers',
    description: 'SAML single sign-on for the Enterprise tier — blocker for two signed deals.',
    owner: 'Engineer A',
    targetInDays: 55,
    tickets: [
      {
        title: 'Add SAML 2.0 identity provider configuration',
        who: 1,
        pts: 3,
        sprint: 'active',
      },
      { title: 'Security review of SSO login flow', who: 3, pts: 2, sprint: 'active' },
      { title: 'Write SSO setup guide for workspace admins', who: 0, pts: 1, sprint: 'active' },
      {
        title: 'Map IdP groups to workspace roles',
        who: 1,
        pts: 3,
        sprint: 'next',
        description: 'Role mapping UI plus just-in-time provisioning.',
      },
      { title: 'Support SCIM user deprovisioning', who: null, pts: null, sprint: null },
    ],
  },
  {
    section: 0,
    name: 'EU Data Residency',
    description: 'Host EU customer data in-region. Paused pending vendor contract.',
    owner: 'PM',
    lifecycle: 'on_hold',
    tickets: [
      { title: 'Evaluate EU region hosting options', who: null, pts: 3, sprint: null },
      { title: 'Inventory services that store customer PII', who: null, pts: 2, sprint: null },
    ],
  },
  {
    section: 1,
    name: 'Mobile Push Notifications',
    description: 'Order and delivery push notifications for iOS and Android apps.',
    owner: 'Engineer C',
    targetInDays: 30,
    tickets: [
      { title: 'Benchmark push provider SDK sizes', who: 1, pts: 2, sprint: 'prev' },
      {
        title: 'Set up APNs and FCM credentials pipeline',
        who: 3,
        pts: 3,
        sprint: 'active',
      },
      { title: 'Build notification preferences screen', who: 2, pts: 2, sprint: 'next' },
      { title: 'Handle deep links from notification taps', who: 1, pts: 2, sprint: 'next' },
      { title: 'Add delivery ETA notification template', who: 2, pts: 1.5, sprint: 'later' },
    ],
  },
  {
    section: 1,
    name: 'Partner Reporting API v2',
    description: 'Faster, paginated reporting endpoints committed to three partners for Q1.',
    owner: 'PM',
    targetInDays: 70,
    tickets: [
      { title: 'Rotate partner API auth keys', who: 1, pts: 3, sprint: 'prev' },
      {
        title: 'Define v2 endpoint contract with partners',
        who: 0,
        pts: 2,
        sprint: 'active',
      },
      {
        title: 'Paginate large report exports',
        who: 1,
        pts: 2,
        sprint: 'active',
        description: 'Blocked on contract sign-off for cursor format.',
      },
      { title: 'Add per-partner rate limiting', who: null, pts: null, sprint: null },
    ],
  },
  {
    section: 2,
    name: 'Loyalty Program',
    description: 'Points-based loyalty scheme. Finance and Marketing still aligning on accrual rules.',
    owner: 'PM',
    tickets: [
      {
        title: 'Clarify points accrual rules with Finance',
        who: 0,
        pts: 1,
        sprint: 'active',
      },
      { title: 'Draft loyalty tier UX concepts', who: null, pts: null, sprint: null },
      { title: 'Estimate loyalty ledger data model', who: 2, pts: 2, sprint: 'later' },
    ],
  },
  {
    section: 2,
    name: 'Marketplace Seller Onboarding',
    description: 'Self-serve onboarding for third-party sellers. Requirements owned by Ops.',
    owner: 'PM',
    tickets: [
      {
        title: 'Run stakeholder workshop on seller KYC requirements',
        who: 0,
        pts: 1,
        sprint: 'next',
      },
    ],
  },
  {
    section: 3,
    name: 'Semantic Product Search Prototype',
    description: 'Prototype embedding-based search to improve zero-result queries.',
    tickets: [
      { title: 'Benchmark vector search options', who: null, pts: null, sprint: null },
      { title: 'Collect top 200 zero-result queries', who: 2, pts: 1, sprint: null },
    ],
  },
  {
    section: 3,
    name: 'Customer Community Forum',
    description: 'Idea: hosted community forum to deflect support tickets.',
    tickets: [{ title: 'Competitive review of community platforms', who: null, pts: null, sprint: null }],
  },
  {
    section: 4,
    name: 'Web Storefront',
    description: 'Ongoing support and improvements for the customer-facing web store.',
    owner: 'Engineer B',
    tickets: [
      { title: 'Fix Lighthouse performance regressions', who: 2, pts: 3, sprint: 'prev' },
      { title: 'Fix image lazy-loading regression on listing pages', who: 2, pts: 2, sprint: 'active' },
      { title: 'Upgrade React Router to latest major', who: 2, pts: 2, sprint: 'active' },
      {
        title: 'Investigate intermittent 502s on product page',
        who: 3,
        pts: null,
        sprint: 'active',
        description: 'Seen in CDN logs ~0.3% of requests since last deploy.',
      },
      { title: 'Improve 404 page with search suggestions', who: null, pts: 1, sprint: null },
    ],
  },
  {
    section: 4,
    name: 'Internal Admin Tools',
    description: 'Back-office tools used by Support and Ops.',
    tickets: [
      { title: 'Migrate payment service to new provider SDK', who: 3, pts: 5, sprint: 'prev' },
      { title: 'Add CSV export to orders admin', who: null, pts: 1, sprint: null },
      { title: 'Rotate expiring service credentials', who: 3, pts: 0.5, sprint: 'next' },
    ],
  },
];

/** Realistic demo workspace: 1 closed, 1 active, 2 planned sprints. No member exceeds capacity. */
export function createDemoData(now: Date = new Date()): AppData {
  const ts = now.toISOString();
  const members = makeMembers(ts);
  const sections = makeSections(ts);

  const activeStart = startOfWeek(now, { weekStartsOn: 1 });
  const mkSprint = (n: number, offsetWeeks: number, status: Sprint['status'], goal: string): Sprint => {
    const start = addDays(activeStart, offsetWeeks * 7);
    return {
      id: newId('spr'),
      name: `Sprint ${n}`,
      goal,
      startDate: d(start),
      endDate: d(addDays(start, 13)),
      status,
      capacities: {},
      snapshot: null,
      createdAt: ts,
      updatedAt: ts,
    };
  };
  const prev = mkSprint(23, -2, 'active', 'Checkout research and payment SDK migration');
  const active = mkSprint(24, 0, 'planned', 'Ship checkout v2 core flow and SSO configuration');
  const next = mkSprint(25, 2, 'planned', 'SSO role mapping and push notification UX');
  const later = mkSprint(26, 4, 'planned', '');
  // Engineer B has 2 days of leave in the active sprint.
  active.capacities[members[2].id] = 8;
  const sprintFor = { prev: prev.id, active: active.id, next: next.id, later: later.id } as const;

  const projects: Project[] = [];
  const tickets: Ticket[] = [];
  let ticketNo = 1;
  const orderInSection = new Map<number, number>();

  for (const p of PROJECTS) {
    const order = orderInSection.get(p.section) ?? 0;
    orderInSection.set(p.section, order + 1);
    const project: Project = {
      id: newId('prj'),
      name: p.name,
      description: p.description,
      sectionId: sections[p.section].id,
      lifecycle: p.lifecycle ?? 'active',
      targetDate: p.targetInDays ? d(addDays(now, p.targetInDays)) : null,
      owner: p.owner ?? '',
      order,
      external: {},
      createdAt: ts,
      updatedAt: ts,
    };
    projects.push(project);
    p.tickets.forEach((t, i) => {
      tickets.push({
        id: newId('tkt'),
        key: `SF-${ticketNo++}`,
        title: t.title,
        description: t.description ?? '',
        projectId: project.id,
        assigneeId: t.who === null || t.who === undefined ? null : members[t.who].id,
        points: t.pts === undefined ? null : t.pts,
        sprintId: t.sprint ? sprintFor[t.sprint] : null,
        order: i,
        external: {},
        createdAt: ts,
        updatedAt: ts,
      });
    });
  }

  let data: AppData = {
    meta: baseMeta(ticketNo),
    members,
    sections,
    projects,
    tickets,
    sprints: [prev, active, next, later],
  };

  // Close the previous sprint through the real business logic so its snapshot is authentic:
  // the rest was done, the checkout layout carries forward, the SDK benchmark returns to backlog.
  const carry = tickets.find((t) => t.title === 'Implement single-page checkout layout')!;
  const back = tickets.find((t) => t.title === 'Benchmark push provider SDK sizes')!;
  const closure = closeSprint(
    data,
    prev.id,
    { [carry.id]: { type: 'carry', sprintId: active.id }, [back.id]: { type: 'backlog' } },
    new Date(`${prev.endDate}T17:00:00`),
  );
  const updated = new Map(closure.ticketUpdates.map((t) => [t.id, t]));
  data = {
    ...data,
    tickets: data.tickets.map((t) => updated.get(t.id) ?? t),
    sprints: data.sprints.map((s) =>
      s.id === prev.id ? closure.sprint : s.id === active.id ? { ...s, status: 'active' } : s,
    ),
  };
  return data;
}
