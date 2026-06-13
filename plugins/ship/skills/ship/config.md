# Ship config

The ship workflow depends on facts about the project and the session that are
stable across runs: whether there's a GitHub remote, the default branch, the
project's quality-gate commands, whether there's a task list, and which
specialized skills are installed. Detecting these on every `/ship` is wasted
work, so they're detected once and cached.

This file is the single source of truth for **where** that cache lives, **what**
it holds, and **how** to (re)detect it. Both the ship skill (first-run detection)
and the `/ship-config` command (explicit re-check) follow the procedure here.

## Location

`.claude/ship.local.json`, relative to the repository root.

The `.local` suffix marks it as environment-specific (remote presence, installed
skills, machine setup) and not meant to be committed. If the project has a
`.claude/` directory convention already, this sits alongside it; create `.claude/`
if it doesn't exist.

## Schema

```json
{
  "version": 1,
  "detectedAt": "2026-06-13T10:30:00Z",
  "environment": {
    "hasGitHubRemote": true,
    "defaultBranch": "main"
  },
  "qualityGates": {
    "typecheck": "npm run typecheck",
    "test": "npm run test:run",
    "build": "npm run build",
    "lint": "npm run lint"
  },
  "tasks": {
    "tasksFile": "docs/TASKS.md"
  },
  "skills": {
    "review": "pr-review-toolkit:review-pr",
    "reviseClaudeMd": "claude-md-management:revise-claude-md",
    "tasksDone": "tasks:tasks-done",
    "commitPushPr": "commit-commands:commit-push-pr"
  }
}
```

Field rules:

- **`version`** — schema version. Currently `1`. If a loaded config has an
  unrecognized version, ignore it and re-detect.
- **`detectedAt`** — ISO-8601 UTC timestamp of the detection that produced this
  file (`date -u +%Y-%m-%dT%H:%M:%SZ`).
- **`environment.hasGitHubRemote`** — `true` if the repo has a GitHub remote.
  This is what decides the PR path (Steps 5/6) vs. the local-merge path (Step 7).
- **`environment.defaultBranch`** — the repo's default branch name.
- **`qualityGates.*`** — the exact command to run for each gate, or `null` if the
  project has no such gate. Keys: `typecheck`, `test`, `build`, `lint`.
- **`tasks.tasksFile`** — path to the task list (`docs/TASKS.md`) if it exists,
  else `null`.
- **`skills.*`** — the exact skill/command name to invoke for each role, or `null`
  if none is available (the skill then falls back to doing it by hand). Keys:
  `review`, `reviseClaudeMd`, `tasksDone`, `commitPushPr`.

## Detection procedure

Gather each field fresh, then write the file. Don't narrate every command.

1. **GitHub remote + default branch.** Check `git remote -v` and `gh repo view`.
   `hasGitHubRemote` is `true` when a GitHub remote exists. For `defaultBranch`,
   prefer `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`; fall
   back to `git remote show origin` (the "HEAD branch" line) or, with no remote,
   the current local default (`git symbolic-ref --short HEAD` only as a last
   resort).

2. **Quality gates.** Read `package.json` scripts, a `Makefile`, and the Commands
   section of `CLAUDE.md`. Map each gate to the command that runs it, **preferring
   single-run / CI variants** (`test:run` over a watch `test`). Account for
   commands that subsume others (a `build` of `tsc -b && vite build` already
   type-checks — still record each gate's own command if it exists separately).
   Set a gate to `null` when the project genuinely has none.

3. **Task list.** Set `tasks.tasksFile` to `docs/TASKS.md` if that file exists,
   else `null`.

4. **Skills.** Read the session's available-skills list (the names that appear in
   context — treat a name as available only if it's actually listed). Record the
   exact name to invoke for each role, or `null`:
   - `review` — prefer `pr-review-toolkit:review-pr`; else another available review
     skill (e.g. a `code-review` skill) or `code-reviewer` subagent name; else
     `null` (self-review).
   - `reviseClaudeMd` — `claude-md-management:revise-claude-md` or `null`.
   - `tasksDone` — `tasks:tasks-done` or `null`.
   - `commitPushPr` — `commit-commands:commit-push-pr` or `null`.

Write the result to `.claude/ship.local.json` with the Write tool.

> Note: skill availability is also visible in the session's available-skills list
> on every run, so it's effectively free to read live. It's cached here anyway so
> the workflow has one source of truth; `/ship-config` keeps it current.
