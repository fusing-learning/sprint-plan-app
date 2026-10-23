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
| `npm test` | Run the Vitest suite (42 tests in 4 files: business rules, persistence, import/export, shared server) |
| `npm run typecheck` | TypeScript check (`tsc --noEmit`) |
| `npm run build` | Typecheck, then build a production bundle to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm start` | Build, then run the shared server for your team (see below) |

## Share it with your team (live, on your network)

Run SprintFlow from one computer (for example your Mac) and everyone on the same network plans in **one shared workspace**. Changes show up for everyone straight away.

```bash
npm install
npm start
```

The server prints the addresses to share, for example:

```
  On this computer:  http://localhost:4000
  For colleagues:    http://192.168.1.23:4000
                     http://Your-MacBook.local:4000
```

- **Firewall:** the first time, macOS may ask whether to allow incoming connections for `node`. Click **Allow**. If colleagues can't connect, check **System Settings → Network → Firewall**.
- **Keep it running:** leave the terminal window open and keep the Mac awake (for example `caffeinate -i npm start`, or **System Settings → Battery/Energy → Prevent automatic sleeping**). If the server stops, browsers show **Reconnecting** and catch up when it's back.
- **Stable address:** the IP address can change. The `.local` name usually doesn't. You can also reserve the IP address in your router.
- **Data:** the workspace is saved in `data/workspace.json`. Before the first change each day a copy goes to `data/backups/` (the last 30 days are kept). Use `SPRINTFLOW_DATA_DIR=/some/folder npm start` to store it elsewhere, and `PORT=4001 npm start` to use another port.
- **Moving your existing plan in:** the shared workspace starts empty and doesn't see the data in your browser at `localhost:5173`. Open the old address, use **Import / Export / Clear → Export JSON**, then open the shared address and use **Import backup**.
- **Simultaneous edits:** each change is checked against the latest plan, so capacity limits hold even when two people edit at the same moment. If someone else's change lands first, yours is not saved, you see a message, and the latest plan loads so you can make your change again.
- **Access:** there is no login. Anyone who can reach the address on your network can view and edit the plan, so run it only on a network you trust (such as the office network, not public Wi-Fi).

For development against the shared server, run `npm run server:api` in one terminal and `npm run dev:shared` in another, then open http://localhost:5173.

## Where your data lives

With `npm start` (shared mode), the data lives on the server in `data/workspace.json`. See [Share it with your team](#share-it-with-your-team-live-on-your-network). The rest of this section is about `npm run dev`, where each browser keeps its own data.

- Everything is stored in **IndexedDB in this browser on this device** (database `sprintflow`). Each change is saved automatically and survives page refreshes and browser restarts.
- Data does **not** sync between computers, browsers or browser profiles. Clearing site data for `localhost:5173` deletes it. Private/incognito windows use separate, temporary storage.
- Use **Import / Export / Clear** in the sidebar to back up (**Export JSON**) or restore (**Import backup**) a workspace. Imports are validated, and you confirm before anything is replaced. Backups from the previous schema (v1) still import.
- **Load demo** replaces the workspace with sample data. **Clear everything** deletes all projects, tasks, sprints and history, keeps the team and sections, and creates a fresh empty active Sprint 1. Filters are reset afterwards. Demo data never comes back unless you load it.

## Planning workflow

The layout is a left sidebar, a main panel and a right capacity column.

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
  data/          Repository interface + IndexedDB (Dexie), HTTP (shared server) and in-memory implementations, demo seed
  state/         PlanningStore (application service), React bindings, selectors
  components/    UI: layout, board, capacity panel, dialogs, history, ui primitives
  integrations/  Jira extension point (interfaces + pure mapping only, no network calls)
server/          Shared-workspace server (Node, no framework): JSON-file storage, REST API, live updates
docs/ARCHITECTURE.md   Data model, persistence, migrations, future Jira/AWS notes
```

## Known limitations

- With `npm run dev`, data is single-user and single-device. Nothing syncs, and two browser tabs editing at the same time can overwrite each other. Use `npm start` to share a live workspace.
- Shared mode has no login or per-person permissions, and needs the host computer to be on and reachable.
- No undo. Destructive actions ask for confirmation, and JSON export is the backup mechanism.
- Projects are moved between sections with **Move to section** in the project menu, not by dragging across sections.
- While filters or search are active, sections can't be dragged. Projects and tasks can still be reordered, and hidden items keep their positions.
- Planning only: there is no task status or progress tracking, and Jira reference fields are not shown in the UI (the optional `external` fields exist in the data for a future integration).
- The design is desktop-first. On narrow screens the sidebar opens from a menu button, the capacity column opens from a header button showing used/total, and some row details are hidden.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the data model and future Jira/AWS notes.
