import type { AppData, ChangeSet } from '@/domain/types';
import { SprintFlowDB } from './db';
import type { PlanningRepository } from './repository';

export class DexiePlanningRepository implements PlanningRepository {
  constructor(private readonly db: SprintFlowDB = new SprintFlowDB()) {}

  private get tables() {
    const { meta, members, sections, projects, tickets, sprints } = this.db;
    return [meta, members, sections, projects, tickets, sprints];
  }

  async load(): Promise<AppData | null> {
    return this.db.transaction('r', this.tables, async () => {
      const meta = await this.db.meta.get('app');
      if (!meta) return null;
      const [members, sections, projects, tickets, sprints] = await Promise.all([
        this.db.members.toArray(),
        this.db.sections.toArray(),
        this.db.projects.toArray(),
        this.db.tickets.toArray(),
        this.db.sprints.toArray(),
      ]);
      return { meta, members, sections, projects, tickets, sprints };
    });
  }

  async apply(changes: ChangeSet): Promise<void> {
    await this.db.transaction('rw', this.tables, async () => {
      const del = changes.delete ?? {};
      if (del.members?.length) await this.db.members.bulkDelete(del.members);
      if (del.sections?.length) await this.db.sections.bulkDelete(del.sections);
      if (del.projects?.length) await this.db.projects.bulkDelete(del.projects);
      if (del.tickets?.length) await this.db.tickets.bulkDelete(del.tickets);
      if (del.sprints?.length) await this.db.sprints.bulkDelete(del.sprints);
      const put = changes.put ?? {};
      if (put.meta) await this.db.meta.put(put.meta);
      if (put.members?.length) await this.db.members.bulkPut(put.members);
      if (put.sections?.length) await this.db.sections.bulkPut(put.sections);
      if (put.projects?.length) await this.db.projects.bulkPut(put.projects);
      if (put.tickets?.length) await this.db.tickets.bulkPut(put.tickets);
      if (put.sprints?.length) await this.db.sprints.bulkPut(put.sprints);
    });
  }

  async replaceAll(data: AppData): Promise<void> {
    await this.db.transaction('rw', this.tables, async () => {
      await Promise.all(this.tables.map((t) => t.clear()));
      await this.db.meta.put(data.meta);
      await this.db.members.bulkPut(data.members);
      await this.db.sections.bulkPut(data.sections);
      await this.db.projects.bulkPut(data.projects);
      await this.db.tickets.bulkPut(data.tickets);
      await this.db.sprints.bulkPut(data.sprints);
    });
  }
}
