import type { AppData, Member, Sprint, Ticket } from './types';
import { SCHEMA_VERSION } from './types';

const TS = '2026-01-01T00:00:00.000Z';
let seq = 0;

function member(id: string, name: string, order: number): Member {
  return { id, name, role: 'Engineer', defaultCapacity: 10, order, createdAt: TS, updatedAt: TS };
}

function sprint(id: string, name: string, status: Sprint['status'], start: string, end: string): Sprint {
  return { id, name, goal: '', startDate: start, endDate: end, status, capacities: {}, snapshot: null, createdAt: TS, updatedAt: TS };
}

/** A minimal workspace for pure domain tests. */
export function fixture() {
  const pm = member('m_pm', 'PM', 0);
  const a = member('m_a', 'Engineer A', 1);
  const b = member('m_b', 'Engineer B', 2);
  const c = member('m_c', 'Engineer C', 3);
  const active = sprint('s_active', 'Sprint 1', 'active', '2026-01-05', '2026-01-18');
  const future = sprint('s_future', 'Sprint 2', 'planned', '2026-01-19', '2026-02-01');
  const data: AppData = {
    meta: { id: 'app', schemaVersion: SCHEMA_VERSION, initialized: true, nextTicketNumber: 1, ticketKeyPrefix: 'T' },
    members: [pm, a, b, c],
    sections: [{ id: 'sec1', name: 'P0', description: '', color: 'rose', order: 0, createdAt: TS, updatedAt: TS }],
    projects: [
      {
        id: 'p1',
        name: 'Project',
        description: '',
        sectionId: 'sec1',
        lifecycle: 'active',
        targetDate: null,
        owner: '',
        order: 0,
        external: {},
        createdAt: TS,
        updatedAt: TS,
      },
    ],
    tickets: [],
    sprints: [active, future],
  };
  return { data, pm, a, b, c, active, future };
}

export function ticket(_f: ReturnType<typeof fixture>, patch: Partial<Ticket>): Ticket {
  seq += 1;
  return {
    id: `t${seq}`,
    key: `T-${seq}`,
    title: `Ticket ${seq}`,
    description: '',
    projectId: 'p1',
    assigneeId: null,
    points: null,
    sprintId: null,
    order: seq,
    external: {},
    createdAt: TS,
    updatedAt: TS,
    ...patch,
  };
}
