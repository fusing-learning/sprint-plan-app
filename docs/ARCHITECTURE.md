# SprintFlow architecture

## Layers

```
React components ──► PlanningStore (application service) ──► PlanningRepository (interface)
        │                    │                                    ├─ DexiePlanningRepository (IndexedDB, used in the app)
        │                    ▼                                    ├─ HttpPlanningRepository (shared server, `npm start`)
        │                    │                                    └─ MemoryPlanningRepository (tests / reference)
        └──────────► domain/ (pure functions: capacity, sprints, backup, ordering)
```

- **`src/domain`** holds plain TypeScript with no React and no storage. Every business rule lives here: capacity derivation, conflict detection, story-point parsing, sprint closing and snapshots, and backup validation.
- **`src/state/planningStore.ts`** runs operations such as `createTicket`, `updateTicket`, `closeSprint`, `clearWorkspace`, `loadDemoData` and `deleteSection`. Each one validates against the domain rules and returns `{ ok, value } | { ok: false, error, conflicts }`. Accepted changes update in-memory state straight away and are then written through the repository in a serialized queue. If a write fails, the store reloads from the repository. The code and data model still say "ticket"; the UI says "task".
- **`src/data/repository.ts`** is the persistence contract: `load()`, `apply(changeSet)` (atomic) and `replaceAll(data)`. To move to a backend, implement `HttpPlanningRepository` with the same three methods (for example `GET /workspace`, `POST /changes`, `PUT /workspace`). No component or domain code needs to change.

## Shared mode (`npm start`)

`server/app.ts` is a small Node HTTP server with no framework. It holds one workspace in memory and in `data/workspace.json`, serves the built frontend, and adds a `<meta name="sprintflow-mode" content="shared">` tag to `index.html`. `src/main.tsx` sees the tag and uses `HttpPlanningRepository` instead of Dexie.

| Endpoint | Purpose |
|---|---|
| `GET /api/workspace` | `{ revision, data }` (`data` is null before first setup) |
| `POST /api/changes` | `{ clientId, baseRevision, changes }` → `{ revision }`, or 409 |
| `PUT /api/workspace` | `{ clientId, baseRevision, data }` → `{ revision }`, or 409 / 400 (validated with `parseBackup`) |
| `GET /api/events?since=n` | Server-Sent Events: `change` (one per revision), `resync` (gap too large to replay), `ready`, and `: ping` heartbeats |

Consistency uses **optimistic concurrency on a single revision counter**. When the store accepts a change it calls `repo.prepareWrite()` synchronously. That records the server revision the change was validated against (the latest revision seen, plus this client's own writes still in flight). The server accepts a write only if `baseRevision` equals its current revision, so capacity and ticket-key rules are never checked against stale data. On a 409 (or any failed write), the repository drops writes queued behind it and the store reloads the workspace. Other people's changes arrive on the event stream and are applied to the in-memory state with `applyChanges`. The client reconnects with backoff and catches up from a replay buffer of recent changes, or reloads when the gap is too large.

## Data model

Schema version: **2**.

| Entity | Key fields |
|---|---|
| `Member` | `id`, `name`, `role`, `defaultCapacity` (0–10), `order` |
| `Section` | `id`, `name`, `description`, `color`, `order`. Priority buckets, fully user-editable |
| `Project` | `id`, `sectionId`, `lifecycle` (active/on_hold/completed/archived), `targetDate?`, `owner`, `order`, `external` (Jira refs, not shown in the UI) |
| `Ticket` (a "task" in the UI) | `id`, `key` (e.g. `SF-12`, never reused), `title`, `description`, `projectId`, `assigneeId?`, `points?` (free text in the UI: any number > 0 and ≤ 10, rounded to 2 decimals; null = unestimated), `sprintId?` (null = backlog), `order`, `external` (Jira refs, not shown in the UI) |
| `Sprint` | `id`, `name`, `goal`, `startDate`, `endDate`, `status` (planned/active/closed), `capacities` (per-member overrides), `snapshot?` |
| `SprintSnapshot` | Immutable JSON copy taken at close: committed, completed (done) and incomplete (not-done) SP, per-person capacity, planned and completed SP, and each task's outcome (`completed` / `returned_to_backlog` / `carried_forward`) |

Tasks are planning-only. There is no work status, readiness, ticket type, acceptance criteria or notes (removed in schema v2). Because nothing tracks progress, the person closing a sprint decides each task's outcome (see `CloseDecision` in `src/domain/sprints.ts`: done, backlog or carry to a planned sprint; `carryAllDecisions` builds the "Carry all" plan in priority order and sends what doesn't fit to the backlog).

Priority (section) and lifecycle (project) are independent dimensions. Tasks in closed sprints are history: they are hidden from the board and shown in Sprint History.

## Persistence and migrations

- Dexie schema versions are declared in `src/data/db.ts`. To change the schema, add `this.version(n).stores(...).upgrade(tx => ...)` and leave existing versions untouched. The `version(2)` upgrade strips `status`, `readiness`, `type`, `acceptanceCriteria` and `notes` from tickets, strips `status`, `readiness` and `type` from snapshot tickets, and sets `meta.schemaVersion` to 2.
- JSON backups contain `{ app: "sprintflow", schemaVersion, exportedAt, data }`. `parseBackup` runs any needed `MIGRATIONS[n]` steps to bring older backups up to date, then validates with zod and checks references (projects → sections, tasks → projects/members/sprints, at most one active sprint). Backups at `schemaVersion` 1 still import: `MIGRATIONS[1]` is the identity, because the zod schemas strip the removed keys. Backups newer than the app supports are rejected.
- `meta.initialized` records that the workspace has been set up. On first launch (no stored workspace) `createEmptyWorkspace` creates 4 members (PM, Engineer A/B/C), the 5 default sections and one empty active "Sprint 1" starting Monday of the current week. Demo data (`createDemoData`) is only loaded when the user asks (**Import / Export / Clear → Load demo**), so it never comes back by itself.
- `clearWorkspace` ("Clear everything") deletes all projects, tasks, sprints and history, keeps members and sections, and creates a fresh empty active Sprint 1. The UI resets filters afterwards.
- On startup the app calls `navigator.storage.persist()` (best effort) to lower the chance of the browser evicting the data.

## Future Jira integration (not implemented)

`src/integrations/jira.ts` defines `IssueTrackerIntegration`, `JiraFieldMapping` and a pure `mapTicketToJiraDraft` helper. The MVP makes no network calls. The optional `external` fields on projects and tasks stay in the data model for this, but are not shown in the UI.

Suggested mapping:

| SprintFlow | Jira |
|---|---|
| Section | No direct equivalent. Keep it local, or map it to a label or priority field if the team wants it |
| Project | An **Epic** (`project.external.jiraEpicKey`) inside a Jira project (`jiraProjectKey` / `jiraProjectId`) |
| Task (`Ticket`) | An issue of one configured `defaultIssueType` (e.g. Task or Story), stored in `ticket.external.jiraIssueKey` and `jiraIssueId`. There is no per-task type |
| Assignee | Jira `accountId`, via a configured `memberAccountIds` map |
| Story points | A **site-specific custom field**. The field ID (e.g. `customfield_10016` on one site) varies between Jira instances, so it must be discovered via `GET /rest/api/3/field` and stored in configuration, never hard-coded |
| Status | Not mapped. SprintFlow tasks have no status, so Jira workflow state is not read or written |
| Sprint | A Jira Software sprint (also a custom field). Optional |

Guidelines for when this is built:
- Local `id`s stay the primary identity. Jira identifiers are optional references.
- Start with a one-way "push / preview" from SprintFlow to Jira before attempting a bidirectional sync engine.
- Keep credentials out of the browser. Use OAuth 2.0 (3LO) or an API token held by a backend in a secrets manager.

## Future AWS hosting (not implemented)

**Amazon Bedrock is a managed service for calling foundation AI models.** It does not host web applications or store application data. It is only relevant if AI features are added later, such as drafting tasks or suggesting estimates.

A simple, low-ops hosting setup for a shared, multi-user SprintFlow:

- **Frontend:** the static Vite build on **S3 + CloudFront** (or **AWS Amplify Hosting**).
- **API:** **API Gateway + Lambda** (Node/TypeScript), implementing the same `PlanningRepository` operations. **App Runner** or **ECS Fargate** also work if a long-running server is preferred.
- **Data:** **Amazon RDS for PostgreSQL / Aurora Serverless v2** (relational fits projects, tasks and sprints well) or **DynamoDB**. Capacity stays derived from tasks, not stored.
- **Auth:** **Amazon Cognito** (or the company's SSO via OIDC/SAML).
- **Secrets:** **Secrets Manager** for the Jira OAuth client and tokens.
- **AI (optional, later):** Lambda calls **Bedrock** server-side, with no keys in the browser.
