---
name: ship
description: >-
  Take a finished coding change from "done writing code" to "ready to merge."
  Use when the user invokes $ship or /ship, asks to ship or wrap up a finished
  change, wants to open a pull request and drive it to green, or asks to refresh
  ship configuration. Run project quality gates, review the diff, update
  tracked-task state, then publish and stabilize a GitHub PR or integrate
  linearly when no GitHub remote exists.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, Skill
---

# Ship

Carry a finished change through verification, review, task completion, and
publication. Invoking this workflow authorizes its normal outward
actions, including pushing a branch and opening or updating a pull request.

Obey two hard rules:

- Never continue past a failing quality gate. Fix it and rerun the gate; if an
  unrelated pre-existing failure cannot safely be fixed, stop for the user.
- Never merge a GitHub pull request. Make it green, address feedback, and leave
  the final merge to the user. The no-remote local integration path is the only
  exception because it creates no pull request.

Optional helper skills are soft dependencies. Use the exact detected helper when
available and its role matches; otherwise use the built-in fallback. Never assume
a helper exists because its plugin is mentioned in documentation.

## Refresh configuration

If the request is `/ship-config`, `$ship refresh config`, or otherwise asks only
to refresh configuration, do not ship anything:

1. Read `config.md` bundled beside this file.
2. Identify the current host, locate its cache as `config.md` describes (in the
   repository's main worktree), and read only that cache.
3. Re-detect every field using the documented procedure.
4. Compare fields other than `detectedAt` and report `old → new` values. Treat
   any older or unknown schema version and invalid JSON as a full re-detection.
5. Write the version-7 result to that same cache path and stop.

## Assess the change

Read `config.md` before using cached values.

1. Identify the runtime as Claude Code or Codex and select only its cache:
   `.claude/ship.local.json` or `.codex/ship.local.json` respectively, inside the
   repository's main worktree. `config.md` gives the exact lookup.
2. If that cache contains valid schema version 7 for the current host, use it.
   If it is missing, invalid, an older version, another version, or records
   another host, run complete detection and overwrite only the selected cache.
   Never read the other host's cache.
3. On first detection, tell the user which cache was written and how to refresh
   it: `/ship-config` in Claude Code or `$ship refresh config` in Codex.
4. Read live state that must never be cached: the **live project facts** in
   `config.md` (`qualityGates` and `tasks.tasksFile`, from the current worktree),
   `git status`, the diff against the base branch, the current branch, worktree
   state, and which tracked task this session's change implements.

Give the user a one-line execution summary, then run the steps in order. If a
cached command or helper is no longer valid, fix the route for this run and tell
the user to refresh the config afterward.

## 1. Pass quality gates

Run every non-null command under `qualityGates`, using the exact command just read.
Run type-check, tests, build, and lint when present. A successful gate already run
against identical code in this session need not be repeated.

Fix failures and rerun affected gates until green. If code changes later in the
workflow, rerun every gate that could be affected.

## 2. Review the local diff

This step reviews the working change and runs before any commit or pull request.
Follow `local-review.md` bundled beside this file, scoped to the working tree
while the change is uncommitted, or to the diff against
`environment.defaultBranch` (pass it as the Codex command's `--base`) once it is
committed.

## 3. Complete a tracked task

When `tasks.tasksFile` is set and the current change clearly implements one task:

- Invoke the exact `skills.taskCompletion` helper when set. For
  `tasks:task-tracking`, request its **Mark a task started or done** operation.
- Otherwise, if the task files carry frontmatter (they open with `---` and a
  `status:` line), the plan belongs to the `tasks` CLI: its `TASKS.md` is generated,
  and editing either by hand leaves the index stale. **Skip task completion** and
  tell the user to run `/tasks:tasks-done` (or the CLI's `tasks set <id>
  status=done`).
- Otherwise (an older plan with checkboxes in `TASKS.md`) update the task checkbox in `docs/TASKS.md` and close out the matching
  progress section directly, including the landed approach, verification, and notes
  for dependent tasks. Pick the progress file from the **layout**, not from the
  shape of the task id:
  - `docs/TASKS.md` and `docs/progress.md` exist, `docs/tasks/` holds only files →
    write to `docs/progress.md`.
  - `docs/TASKS.md` and `docs/progress/` exist, `docs/tasks/` holds only
    subdirectories, **and every epic directory has a matching
    `docs/progress/<epic>.md`** → write to your task's `docs/progress/<epic>.md`,
    and refresh that file's `Epic summary` if the change affects what other epics
    need to know.
  - **Anything else — both present, one missing, `TASKS.md` absent, loose files
    beside epic directories, or an epic with no progress file — is a mixed layout.
    Skip task completion**, say the plan looks like an interrupted migration and
    needs recovering first, and carry on with the rest of the ship steps. A slash
    in the task id is not proof the split finished, and neither is the mere
    existence of `docs/progress/`: a migration that moved every task file but only
    wrote some of the logs looks like epic mode until you check coverage. Creating
    the missing log here, on the way to publishing, is how a partial migration
    becomes a permanent one.

Identify the task from the task goal, branch, diff, and session context. Ask the
user if multiple tasks remain plausible. Skip when there is no task file or the
change is not tracked.

## 4. Publish when a GitHub remote exists

Follow this path only when `environment.hasGitHubRemote` is true.

1. If currently on `environment.defaultBranch`, create a feature branch before
   committing. Never commit the change directly on the default branch.
2. If `skills.publishing` is set, invoke that exact helper. Otherwise stage the
   intended files, commit with a clear imperative summary and rationale, push
   with upstream tracking, and create a concise PR with `gh pr create`.
3. Honor repository and user commit conventions. Do not stage unrelated changes.
4. Record whether the resulting pull request is a draft. In particular,
   `github:yeet` normally creates a draft; that is an intermediate state, not the
   end of this workflow.

Continue immediately to stabilization. Do not stop merely because a publishing
helper returned a pull-request URL.

## 5. Drive the pull request to green

Hand the pull request just published to the `drive-pr` skill bundled with this
plugin — `ship:drive-pr` through the Skill tool in Claude Code, `$drive-pr` in
Codex — with its number and `--mark-ready`, since a draft from step 4 is this
workflow's intermediate state rather than the user's choice. It watches checks,
rebases when the branch falls behind, reviews every fix with `local-review.md`
before pushing it, and replies to and resolves review threads. If the skill
cannot be invoked, read `../drive-pr/SKILL.md` relative to this file and follow
it directly.

It reuses the config already loaded here. Never merge the pull request.

## 6. Integrate linearly when no GitHub remote exists

Follow this path only when `environment.hasGitHubRemote` is false:

1. Create a feature branch if currently on the default branch, then commit the
   intended change.
2. Rebase the feature branch onto the latest local default branch. If that branch
   tracks a remote, fetch first. Resolve conflicts without discarding user work.
3. Rerun all quality gates after the rebase and fix any failures.
4. Fast-forward the default branch to the rebased feature branch with
   `git merge --ff-only`. If the default branch is checked out in another
   worktree, stop and explain instead of forcing the operation.

Report the resulting default-branch commit.

## Finish

Summarize the gates that passed, review outcome, task updates, and publication
result. For GitHub, include the PR URL, green status, the review threads replied
to and resolved, and whether it was marked ready for review; remind the user that
the final merge remains theirs. For no-remote integration, include the resulting
commit. Call out anything skipped and why.
