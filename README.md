# SprintFlow

Local-first sprint planning for a small product team. You plan from the highest-priority projects down and see each person's remaining story-point (SP) capacity update as you assign work. SprintFlow is planning-only: tasks have no status, so progress is tracked elsewhere.

Built for a PM plus three engineers who plan every two weeks. Each person has a maximum of **10 SP per sprint** (1 SP ≈ 1 person-day).

## Run it

Requirements: Node.js 18+ (tested on Node 24) and npm.

```bash
npm install
npm run dev
```

Open http://localhost:5173. The first launch gives you a clean workspace: 4 team members (PM, Engineer A/B/C), the 5 default priority sections, and one empty active **Sprint 1** starting Monday of the current week. Demo data is opt-in: **Import / Export / Clear → Load demo**.

Other commands:

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server on port 5173 |
| `npm test` | Run the Vitest suite (46 tests in 4 files: business rules, persistence, import/export, cut-line ledger) |
| `npm run typecheck` | TypeScript check (`tsc --noEmit`) |
| `npm run build` | Typecheck, then build a production bundle to `dist/` |
| `npm run preview` | Serve the production build locally |

## Where your data lives

- Everything is stored in **IndexedDB in this browser on this device** (database `sprintflow`). Each change is saved automatically and survives page refreshes and browser restarts.
- Data does **not** sync between computers, browsers or browser profiles. Clearing site data for `localhost:5173` deletes it. Private/incognito windows use separate, temporary storage.
- Use **Import / Export / Clear** in the sidebar to back up (**Export JSON**) or restore (**Import backup**) a workspace. Imports are validated, and you confirm before anything is replaced. Backups from the previous schema (v1) still import.
- **Load demo** replaces the workspace with sample data. **Clear everything** deletes all projects, tasks, sprints and history, keeps the team and sections, and creates a fresh empty active Sprint 1. Filters are reset afterwards. Demo data never comes back unless you load it.

## Planning workflow

The layout is a left sidebar, a main panel and a right capacity column. The header switches the main panel between the **Ledger** and the **Board**, and between **Light** and **Dark** themes. Both choices are remembered in this browser.

- **Sidebar:** search (press `/`), **Active sprint / Future sprints / Sprint history**, **Show** (All tasks / In sprint / Backlog / Archived projects), a **People** list with used/capacity (click a person to filter to their tasks), **Unassigned**, a **Sections** jump list, **Team settings** and **Import / Export / Clear**. The sidebar can be hidden.
- **Main panel:** a header with breadcrumb, sprint switcher, status, dates and **Edit / Close / Activate sprint** and **New sprint**. Below it, a filter-chip bar (for example "Assignee is Engineer A ×"), a **Filter** menu, an **Expand** menu (expand/collapse all sections and all projects), **+ Section** and **New project**, then the board.
- **Capacity column:** see [Capacity rules](#capacity-rules).

Planning a sprint:

1. Open **Active sprint**. Start at **P0 — Executive Priority** and work down the sections.
2. In each project:
   - Add a task with the inline add box (press Enter), or use **+** / **Full form** for title, description, project, assignee, SP and sprint.
   - Pick the assignee on the row. The picker shows how much capacity each person has left.
   - Type story points into the pill-shaped **SP** field. Any number greater than 0 and up to 10 is allowed (rounded to 2 decimals); empty means unestimated. **Enter** or leaving the field commits, **Escape** reverts, and invalid input shows an error and reverts.
   - Click the checkbox at the start of a row to move the task in or out of the sprint you're planning. Sprint tasks get an indigo tint and an accent bar on the left.
3. Capacity updates as soon as you change something. An assignment that would push someone over capacity is refused, and a message says how many SP they have left.
4. Use **Future sprints** to plan ahead. The capacity column then shows **Projected capacity** for that sprint, which does not affect the active sprint.
5. **Close sprint** asks what happened to each task, since SprintFlow has no status to infer it from:
   - **Done** (default): the task stays with the closed sprint as completed history.
   - **Backlog**: the task returns to the backlog.
   - **Carry forward**: the task moves (never copies) to a planned sprint, checked against that sprint's capacity.

   Bulk buttons: **All done**, **All to backlog** and **Carry all**. Carry all goes in priority order and sends whatever doesn't fit to the backlog. Closing saves a read-only snapshot with committed, done and not-done SP, and planned/completed SP per person.
6. Closed sprints' tasks no longer appear on the board. **Sprint history** shows the snapshot and what happened to every task.

Shortcuts and tips:
- `/` focuses search. `⌘/Ctrl + Enter` saves the task dialog.
- Applying a filter expands the matching projects once. Projects and sections stay collapsible while filtered. Each section header also has its own expand/collapse-all-projects button.
- Archived projects are hidden from the board. View them with the sidebar **Archived projects** item (or **Filter → Show archived projects**).
- Drag the handles to reorder sections, projects and tasks. Each item's **⋯** menu also has **Move up / Move down**, and keyboard drag works too: focus a handle, press Space, use the arrow keys, then press Space again.

### Cut Line Ledger

The ledger is a dense table of every task ranked top-down: section (P0 first), then project, then task, in the same order as the board. Columns are rank, task, owner, SP and a running total against the team's capacity.

- Going down the list, each task with an owner and SP is counted until one would go past the team's capacity or its owner's capacity for that sprint. An amber **cut line** sits above that task and says why, for example "Next task needs 3 SP from Engineer C, who has 2 left." Rows below it are dimmed.
- Only backlog tasks and tasks already in the sprint you're planning are ranked. Tasks in another open sprint show that sprint's name and are skipped. Projects that are on hold, completed or archived are not ranked; a section whose projects are all like that shows "Not this sprint" and starts collapsed.
- Tasks above the line without an owner or SP are flagged **Not counted** and never move the line.
- The line is guidance. It never changes which tasks are in the sprint: tick the checkbox on a row as before, or use **Fill to line** to add every counted task above the line that isn't in the sprint yet. Each one still goes through the normal capacity check, so a task that doesn't fit is refused with the usual message.
- The header shows SP above the line / capacity, SP and task count below the line, flags and what's actually in the sprint. Person cards show SP above the line for each person (click to filter), and the **Incomplete planning** card filters to the flagged tasks.
- Re-rank with the same drag handles and **Move up / Move down** menu items as the board. Search, filters and future sprints (projected capacity) work the same way. On narrow screens the table scrolls sideways inside its own box.

## Capacity rules

All capacity numbers are calculated from the tasks every time; no "remaining capacity" value is stored.

- Backlog tasks never use capacity.
- A task uses capacity only when it is in that sprint **and** has an assignee **and** has an SP estimate.
- Changing the assignee moves the SP from one person to the other. Removing a task from the sprint frees its SP.
- A planned sprint's tasks only count toward that sprint's projected capacity.
- Capacity can be lowered per sprint for leave (**Edit sprint**), but never raised above 10. You can't lower it below what is already allocated.
- Sprint tasks with no assignee or no SP are allowed, but they're flagged as **incomplete planning** and are not counted as planned work.
- A task belongs to at most one sprint at a time (`ticket.sprintId`), so it can't be planned twice.

The capacity column shows:
- **Total** allocated / capacity and SP remaining.
- **People**: used/capacity and remaining per person. Click a row to filter the board to that person.
- **Incomplete planning**: tasks without an assignee and tasks without SP. Click a row to filter to those tasks.
- **Allocation**: where the sprint's SP goes, with a **Priority | Project** toggle. When a person is selected, it shows that person's SP split instead of the team's.

## Project structure

```
src/
  domain/        Pure business logic: types, capacity rules, sprint closing, backup validation
  data/          Repository interface + IndexedDB (Dexie) and in-memory implementations, demo seed
  state/         PlanningStore (application service), React bindings, selectors
  components/    UI: layout, board, capacity panel, dialogs, history, ui primitives
  integrations/  Jira extension point (interfaces + pure mapping only, no network calls)
docs/ARCHITECTURE.md   Data model, persistence, migrations, future Jira/AWS notes
```

## Known limitations

- Single-user and single-device. Nothing syncs, and two browser tabs editing at the same time can overwrite each other. Reload a tab to pick up changes made in another.
- No undo. Destructive actions ask for confirmation, and JSON export is the backup mechanism.
- Projects are moved between sections with **Move to section** in the project menu, not by dragging across sections.
- While filters or search are active, sections can't be dragged. Projects and tasks can still be reordered, and hidden items keep their positions.
- Planning only: there is no task status or progress tracking, and Jira reference fields are not shown in the UI (the optional `external` fields exist in the data for a future integration).
- The design is desktop-first. On narrow screens the sidebar opens from a menu button, the capacity column opens from a header button showing used/total, and some row details are hidden.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the data model and future Jira/AWS notes.
