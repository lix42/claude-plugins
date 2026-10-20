# claude-plugins

Custom Claude Code, Codex, and OpenCode extensions by [lix42](https://github.com/lix42).

## Installation

### Claude Code

Add this marketplace to your Claude Code settings (`~/.claude/settings.json`):

```json
{
  "extraKnownMarketplaces": {
    "lix42": {
      "source": {
        "source": "git",
        "url": "https://github.com/lix42/claude-plugins.git"
      }
    }
  }
}
```

Then enable individual plugins under `enabledPlugins`:

```json
{
  "enabledPlugins": {
    "tasks@lix42": true,
    "ship@lix42": true,
    "pr-panel@lix42": true
  }
}
```

### Codex

Add this repository as the `lix42` marketplace, then install either or both
Codex-compatible plugins:

```sh
codex plugin marketplace add lix42/claude-plugins
codex plugin add tasks@lix42
codex plugin add ship@lix42
```

`pr-panel` is not available in Codex: it needs a host UI integration, not a skill.

### OpenCode V2

Install the integration package directly from GitHub (OpenCode **2.0.32+**):

```sh
opencode plugin add github:lix42/claude-plugins#main
```

This installs all three features globally: task and shipping skills, their slash
commands, eight shipping subagents, and the PR-panel terminal UI. No local clone,
skill symlinks, skills.sh registration, or separately copied commands are needed.
The server and terminal load the package's two entrypoints automatically.

Use `/tasks-setup`, `/tasks-next`, `/start-task <task>`, `/ship`, or `/pr`.
Skills can also be loaded explicitly with `@task-tracking` or `@ship`.
The task CLI requires Node **22.18+**; PR operations require authenticated `gh`
on the **OpenCode server's** PATH.

Update with `opencode plugin update`. To pin a release or complete commit hash,
replace `#main` in the install target. See
[the OpenCode integration guide](packages/opencode/README.md) for options,
reviewer models, remote-server setup, and development checks.

## Plugins

### tasks

Plan a project as one file per task under `docs/tasks/`, each opening with
frontmatter that holds its status and dependencies — so you always know what's ready
to work on next. A bundled, dependency-free CLI (`cli/tasks.ts`, run with Node
22.18+) queries and updates the plan and generates `docs/TASKS.md`; agents call it
instead of editing checkboxes.

#### Layout it manages

```
docs/
  TASKS.md           # generated index: header + dependency graph + task list
  tasks/_header.md   # hand-written top of TASKS.md: intro and concise design
  tasks/<name>.md    # one file per task: frontmatter, then goal/design/how to verify
  progress.md        # running execution log: how each task was carried out
  design.md          # optional: full design spec if it outgrows the header
```

```markdown
---
title: Expression parser and evaluator
status: todo            # todo | doing | done | closed
deps: [tui-skeleton]    # hard dependencies: gate readiness
summary: evaluate "2+3*4" to 14
---
```

```sh
tasks ready                         # what can start now, ranked by leverage
tasks show parser                   # fields, deps with status, dependents
tasks set parser status=done        # …and prints what just became ready
tasks log parser "how it went"      # append a dated progress entry
tasks new ui-grid --title "Grid" --deps parser
tasks mv ui-grid ui/grid            # rename or move between epics, links included
tasks check                         # cycles, dangling deps, stale index — CI-friendly
```

`tasks` here is shorthand for `node <plugin>/skills/task-tracking/cli/tasks.ts`;
there is nothing to put on your `PATH`, and `tasks help` lists every command. It
finds `docs/` by walking up to the git root.

Every command takes `--json`. `progress.md` is the **execution log** beside the plan
— one section per task recording *how* the work actually went: what was done,
decisions made, what works and what doesn't, and notes for dependent tasks. Agents
read it before starting a task and append to their own section as they work, so
parallel work merges cleanly and each task builds on what the last one learned.

Plans from earlier versions (checkboxes and a dependency list in `TASKS.md`) convert
with `/tasks-migrate`, which reads the dependency list, "Depends …" prose, or the
task files' own links, and reports anything it couldn't map.

#### Epics, for plans that outgrow a flat list

Past roughly a dozen tasks — or several separable subsystems, or once the log
outgrows a single comfortable read — a flat list stops working, and every agent
starting any task pays to read the whole project's history. At that point the plan
shards by **epic**:

```
docs/
  TASKS.md                    # still one generated file: header + epic rollup + tasks by epic
  tasks/<epic>/_epic.md       # epic title, order, and scope
  tasks/<epic>/<name>.md      # task id is "<epic>/<name>"
  progress/<epic>.md          # one log per epic, opening with an Epic summary
  design.md                   # optional: full design spec, as in flat mode
```

Starting a task then means reading your epic's log plus the `Epic summary` of the
epics you depend on — not everything.

Epics are **structural**: an epic is a module, layer, or surface whose tasks share
code and concepts, derived from the design's architecture. They are deliberately
*not* delivery stages — "Phase 1" and "MVP" cut across every subsystem, so their
tasks share no files and no context, which defeats the point.

Dependencies stay task-level and canonical; epic status and the epic rollup diagram
are derived from them, never authored separately. Small projects stay flat, and
both layouts are fully supported — `/tasks-group` promotes a flat plan to epics
once it has genuinely grown (`tasks group` moves every file, link and log section in
one step). There's no reverse: to reshuffle a plan that's already epic mode, move
tasks one at a time with `tasks mv`.

#### Commands

| Command | Description |
|---------|-------------|
| `/tasks-setup [requirement]` | Interview, agree on a design, split into tasks, and (after approval) create the task files |
| `/tasks-next [epic]` | List tasks whose dependencies are all done, with priority and parallelism suggestions |
| `/tasks-update [change]` | Add/remove/split/move/change tasks and keep the dependency graph consistent |
| `/tasks-done [task]` | Mark a task complete and show what it just unblocked |
| `/tasks-group [hint]` | Promote an oversized flat task list to structural epics and split the progress log per epic |
| `/tasks-migrate` | Convert a plan from the checkbox format to frontmatter task files |
| `/tasks:start-task <task>` | Create a branch + sibling worktree for the task from the remote default branch, switch into it, then explain the task and agree on a plan |

Developing the CLI: `node --test 'plugins/tasks/skills/task-tracking/cli/test/*.test.ts'`
runs the tests and `tsc -p plugins/tasks/skills/task-tracking/cli` typechecks it; neither
installs anything.

`/tasks:start-task` checks for an existing branch (local or remote), folder, or
worktree before creating anything — including a worktree whose folder was deleted
— and asks whether to reuse it, recreate it, or stop. It never deletes or resets
anything without your answer. Task `app/state` in epic mode gets branch
`app/state` and folder `../app-state`. It runs only when invoked (in Codex,
`$start-task`), since it creates branches and worktrees.

The bundled `task-tracking` skill also triggers automatically when you ask about
the plan, what to work on next, or say a piece of work is done — so you don't have
to remember the commands.

In Codex, invoke `$task-tracking` explicitly or ask naturally to set up a plan,
find the next unblocked work, update the plan, mark a task done, or group the
tasks into epics. The Claude Code `/tasks-*` commands remain available and route
to the same shared skill.

### ship

Take a finished change from "done writing code" to "ready to merge" in one step.

Run `/ship` in Claude Code, invoke `$ship` in Codex, or say “ship it” after
finishing a task. It works these steps in order, adapting to the host and the
optional helper skills installed in the current session:

1. **Rebase** — brings the change up to date with its base first, via `rebase`
   (below), so everything after it checks the change as it will land.
2. **Quality gates** — discover and run the project's type-check / test / build /
   lint commands and fix any failures (never ships past a red gate).
3. **Code review** — reviews the local change before anything is committed, via
   `review-fix-loop` (below), which fixes the warranted findings and re-reviews
   the fixes. No open PR is required.
4. **Task** — if `docs/TASKS.md` exists and the session worked a task, marks it
   done with the host's task helper (`/tasks:tasks-done` in Claude Code). Without
   one, a frontmatter plan is left for you to run `/tasks:tasks-done`, since its
   `TASKS.md` is generated; an older checkbox plan is updated directly.
5. **PR** — if there's a GitHub remote: branch if needed, rebase again in case
   the base moved during review, then commit + push + open a PR using the
   host's publishing helper when available, else `git`/`gh`.
6. **Drive to green** — hands the PR to `drive-pr` (below): polls checks, fixes
   failures, rebases (via `rebase`) when the PR falls behind, and addresses review comments.
   Every fix gets the same local review as step 3 before it is pushed, and every
   handled review thread is replied to and resolved. Stops once green — the final
   merge is left to you.
7. **No remote** — if there's no GitHub remote, rebases (via `rebase`) onto the
   default branch and fast-forward merges to keep history linear (safe for parallel worktrees).

A caller that already did steps 2 or 3 can pass `--skip-gates` or
`--skip-review` (`/ship --skip-review`). `--skip-review` counts only a
`review-fix-loop` run that left no critical or important finding open, or a
`review-changes` run with no findings — not `/code-review` or another reviewer. Either skip lapses
when the rebase in step 1 pulls in upstream commits or later code changes, and
the PR-time rebase and `drive-pr` still verify their own changes.

On its first run in a repo, `ship` detects the stable facts it depends on — host,
GitHub remote, default branch, and the exact optional helper-skill names
installed — and caches them in
`.claude/ship.local.json` for Claude Code, `.codex/ship.local.json` for Codex,
or `.opencode/ship.local.json` for OpenCode.
The cache lives in the repository's main worktree, so all of its worktrees share
one. Quality-gate commands and task-list presence can differ by branch, so they
are read from the current worktree on every run instead. The host caches are
independent. Run
`/ship-config` in Claude Code or `$ship refresh config` in Codex to re-detect and
report changes after the project or installed plugins change.

The `ship` skill also triggers when you say things like "ship it" or "ready to
open a PR." It never merges a GitHub pull request; if a publishing helper opens a
draft PR, `ship` drives it green and then marks it ready for review.

#### drive-pr

Step 6 on its own, for any open PR — including ones `ship` didn't open. Run
`/drive-pr [number|url]` in Claude Code or `$drive-pr` in Codex; with no PR given
it uses the current branch's. It checks out the PR's branch when the working tree
is clean, watches checks and fixes failures, rebases onto the PR's base when it
falls behind, and works through review comments: each is fixed or declined with a
reason, fixes are reviewed locally before they are pushed, and every handled
thread gets a reply and is resolved. A draft stays a draft unless you pass
`--mark-ready`. It never merges.

#### rebase

Brings the current branch up to date with its base — the PR's base when there is
an open PR, else the default branch, or one you name with `/rebase [base]` in
Claude Code (`$rebase` in Codex). `ship` and `drive-pr` use it for every rebase.

When the branch is behind, the bundled `rebase-scout` agent (on Sonnet) first
weighs the base's new commits against the branch's change — whether or not git
reports conflicts. It looks for upstream work that makes the change simpler or
redundant, that takes the area in another direction, that the change now needs
to cover too, or that changed a contract the change relies on, and reads each
conflict to tell textual noise from colliding intent. With no or small impact it
rebases, resolves conflicts, and makes the mechanical adaptations itself. With a
large impact it changes nothing and reports back; the main agent then decides
how to adapt, and asks you when the decision changes what the branch is for.
Afterwards the quality gates rerun and any conflict resolution or adaptation is
reviewed like any other fix. It never pushes.

#### review-changes

Reviews a local change — uncommitted work, or a branch's diff against its base —
with specialized reviewer agents, and reports one merged list of findings. Run
`/review-changes [base|range] [focus]` in Claude Code; `review-fix-loop` runs it
for every review, so `ship`, `drive-pr`, and `rebase` use it too. It only
reports: it never edits, commits, or comments on GitHub.

It works as an orchestrator. It resolves the scope, profiles the change (files,
size, and signals such as error handling, security-sensitive code, or new types
in the diff), picks the reviewers that apply, and chooses each one's model —
lowering an Opus reviewer to Sonnet for a tiny fix, raising a Sonnet reviewer to
Opus when its area is the heart of a large change. The reviewers run in
parallel; their findings are deduplicated and grouped by severity.

| Reviewer | Looks for | Default model |
|---|---|---|
| `review-bugs` | Logic errors, edge cases, async and concurrency, broken callers | Opus |
| `review-security` | Injection, trust boundaries, authorization, secrets | Opus |
| `review-error-handling` | Silent failures, masking fallbacks, missing cleanup | Sonnet |
| `review-tests` | Coverage gaps for new behavior, tests that cannot fail | Sonnet |
| `review-conventions` | `CLAUDE.md` / `AGENTS.md` rules and the local idiom | Sonnet |
| `review-types` | Type invariants, illegal states, public type contracts | Sonnet |
| `review-docs` | Comments and docs the change made wrong | Sonnet |

To add a reviewer (a CSS reviewer, say), see
[`plugins/ship/docs/adding-a-reviewer.md`](plugins/ship/docs/adding-a-reviewer.md).

Ship no longer runs a Codex review itself, and it never calls `/code-review`.
Run `/codex:review` or `/code-review` yourself for a second opinion.

The orchestrator uses Claude Code's subagents or the OpenCode integration's
`ship/review-*` subagents. OpenCode inherits the session model unless configured
otherwise; it does not assume access to Claude model aliases. In Codex it
currently falls back to an installed local-diff review skill, or to
reviewing against the same reviewers' checklists itself; native Codex support
is planned.

#### review-fix-loop

Reviews a local change with `review-changes`, fixes what it finds, and
re-reviews the fixes. Run `/review-fix-loop [base|range] [focus] [--rounds <n>]`
in Claude Code (`$review-fix-loop` in Codex); `ship`, `drive-pr`, and `rebase`
use it for every review. It edits the working tree only: it never commits,
pushes, or comments on GitHub, and leaves the fixes uncommitted for you.

Each finding is checked against the code before it is fixed, and false
positives are dropped with the reason. After each round of fixes the loop
decides how far the fixes reach, and so what the next review covers:

| A fix that is… | For example | Next review covers |
|---|---|---|
| Contained | a private rename, a typo, a comment, an added test | the fix's diff |
| Contract | a changed signature, return value, error, config key, or shared name | the fix's diff plus the unchanged code that relies on it — callers, tests, docs |
| Rework | a different approach, or a large fix | the whole original scope again, plus the unchanged code outside it that relies on a changed contract |

Findings you or the caller declined, and false positives already rejected, are
passed to every review so they are not raised again.

It stops when a review finds nothing, or after 3 re-reviews (`--rounds` changes
the cap). Findings from the re-review at the cap are left open rather than fixed
without a review. A new critical finding that holds up resets the count; a
critical finding that comes back after its fix stops the loop for you, as does
any critical or important finding still open at the end. Resets never take it
past twice the cap.

### pr-panel

Available as a Claude Code mod and as part of the OpenCode integration. The
OpenCode view uses a native session panel; **Fix** presents an editable preview
and asks for explicit Send confirmation rather than replacing the composer.

A live panel for the GitHub PRs a session opens. Any `gh pr create` the session
runs (so `/ship` too), the current branch's open PR at session start, and any PR
named with `/pr <url|number>` gets a tab showing checks, latest reviews,
unresolved review threads and recent comments. A one-line summary per PR sits
above the prompt.

Buttons enable or disable auto-merge, merge with a method the repo allows (after
a confirmation), mark a draft ready, and re-run failed Actions runs. **Fix** on a
failed check or an unresolved thread puts a prompt for Claude in the prompt box
for you to review.

It polls with conditional requests that cost nothing against the rate limit
while nothing changes, and raises a notification when checks finish, a review
lands, or the PR is merged. Requires an authenticated `gh`. See
[plugins/pr-panel/README.md](plugins/pr-panel/README.md) for the pane's keys and
how polling works.

#### Commands

| Command | Description |
|---------|-------------|
| `/pr` | Open the panel |
| `/pr <url\|number>` | Track a PR; a number resolves against the repo of the PR shown, or the current branch's |
| `/pr untrack` | Stop tracking the PR shown |
