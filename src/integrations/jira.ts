import type { ID, Member, Project, Ticket } from '@/domain/types';

/**
 * Extension point for a FUTURE Jira integration. Nothing in the MVP calls Jira.
 *
 * Design notes (see docs/ARCHITECTURE.md for the full mapping):
 * - Local IDs are the source of identity. Jira identifiers live in the optional
 *   `external` fields (`jiraProjectId`, `jiraProjectKey`, `jiraEpicKey`,
 *   `jiraIssueKey`, `jiraIssueId`) and are never used as primary keys.
 * - The story-point field is instance-specific (e.g. "customfield_10016" on one
 *   site, something else on another) and must come from configuration, never a constant.
 * - Credentials must be held server-side (OAuth 2.0 3LO or an API token in a
 *   secrets manager). The browser must never store or send Jira credentials.
 */

export interface JiraFieldMapping {
  /** Jira custom field ID that stores story points on this Jira site. Discovered via /rest/api/3/field. */
  storyPointsFieldId: string;
  /** Optional custom field for sprint, if the team uses Jira Software sprints. */
  sprintFieldId?: string;
  /** Map SprintFlow member IDs to Jira accountIds. */
  memberAccountIds: Record<ID, string>;
  /** Jira issue type to create for SprintFlow tasks, e.g. "Task" or "Story". */
  defaultIssueType: string;
}

export interface JiraIssueDraft {
  projectKey: string;
  summary: string;
  description: string;
  issueType: string;
  epicKey?: string;
  assigneeAccountId?: string;
  storyPoints?: number;
  fields: Record<string, unknown>;
}

export interface SyncPreviewItem {
  ticketId: ID;
  action: 'create' | 'update' | 'skip';
  reason?: string;
}

/**
 * Contract a future Jira adapter would implement — typically behind a backend
 * API, not in the browser. Kept intentionally small; no sync engine is implied.
 */
export interface IssueTrackerIntegration {
  readonly name: string;
  isConfigured(): boolean;
  /** Pure mapping from local model to an issue payload. */
  toIssueDraft(ticket: Ticket, project: Project, members: Member[], mapping: JiraFieldMapping): JiraIssueDraft;
  /** Dry run: what would be pushed, without performing any network calls. */
  previewSync(tickets: Ticket[]): Promise<SyncPreviewItem[]>;
}

/** Reference mapping helper (pure, no network). Useful for future adapters and tests. */
export function mapTicketToJiraDraft(ticket: Ticket, project: Project, mapping: JiraFieldMapping): JiraIssueDraft {
  const fields: Record<string, unknown> = {};
  if (ticket.points !== null) fields[mapping.storyPointsFieldId] = ticket.points;
  return {
    projectKey: project.external.jiraProjectKey ?? '',
    summary: ticket.title,
    description: ticket.description,
    issueType: mapping.defaultIssueType,
    epicKey: project.external.jiraEpicKey,
    assigneeAccountId: ticket.assigneeId ? mapping.memberAccountIds[ticket.assigneeId] : undefined,
    storyPoints: ticket.points ?? undefined,
    fields,
  };
}

/** Placeholder used by the MVP: always unconfigured, performs no I/O. */
export const disabledJiraIntegration: IssueTrackerIntegration = {
  name: 'Jira (not configured)',
  isConfigured: () => false,
  toIssueDraft: (ticket, project, _members, mapping) => mapTicketToJiraDraft(ticket, project, mapping),
  previewSync: async (tickets) => tickets.map((t) => ({ ticketId: t.id, action: 'skip', reason: 'Jira integration is not configured' })),
};
