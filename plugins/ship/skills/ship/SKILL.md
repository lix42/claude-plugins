---
name: ship
description: >-
  Take a finished coding change from "done writing code" to "ready to merge."
  Use when the user invokes $ship or /ship, asks to ship or wrap up a finished
  change, wants to open a pull request and drive it to green, or asks to refresh
  ship configuration. Rebase onto the base, run project quality gates, review
  the diff, update tracked-task state, then publish and stabilize a GitHub PR
  or integrate linearly when no GitHub remote exists.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, Skill
---

# Ship

Carry a finished change through verification, review, task completion, and
publication. Invoking this workflow authorizes its normal outward
actions, including pushing a branch and opening or updating a pull request.

In OpenCode, load bundled skills with the `skill` tool using exact IDs:
`ship`, `rebase`, `review-fix-loop`, `review-changes`, and `drive-pr`. Claude
`ship:*` IDs below are not OpenCode IDs. Use the detected `task-tracking` skill
to mark tasks done, and `/tasks-done` as the user-facing fallback command.

Obey two hard rules:

- Never continue past a failing quality gate. Fix it and rerun the gate; if an
  unrelated pre-existing failure cannot safely be fixed, stop for the user.
- Never merge a GitHub pull request. Make it green, address feedback, and leave
  the final merge to the user. The no-remote local integration path is the only
  exception because it creates no pull request.

Optional helper skills are soft dependencies. Use the exact detected helper when
available and its role matches; otherwise use the built-in fallback. Never assume
a helper exists because its plugin is mentioned in documentation.

Inputs, from the user or the calling workflow:

- **`--skip-gates`** — the caller already ran this repository's `qualityGates`
  commands, green, against the change as it stands. Skip step 2.
- **`--skip-review`** — the caller already ran this plugin's `review-fix-loop`
  skill on the change as it stands, and it left no critical or important
  finding open. Skip step 3. A bare `review-changes` run counts only when its
  report had no findings, since fixes made after it went unreviewed. Another
  reviewer — `/code-review`, `/codex:review`, a human — is not the same review
  and does not count: when that is what the caller ran, run step 3 anyway.

A skip vouches only for the code the caller checked, so it lapses — run the
step anyway and tell the user why — when:

- the rebase in step 1 integrated upstream commits or adapted the change, since
  the code being shipped is no longer the code that was checked; or
- this workflow changes code before publishing, such as a gate fix after a
  skipped review: review that new code with `review-fix-loop`, and rerun every
  gate it could affect.

The skips cover steps 2 and 3 only. The pre-publish rebase in step 5 and
`drive-pr` in step 6 still verify whatever they change, because the caller never
checked that code.

## Refresh configuration

If the request is `/ship-config`, `$ship refresh config`, or otherwise asks only
to refresh configuration, do not ship anything:

1. Read `config.md` bundled beside this file.
2. Identify the current host, locate its cache as `config.md` describes (in the
   repository's main worktree), and read only that cache.
3. Re-detect every field using the documented procedure.
4. Compare fields other than `detectedAt` and report `old → new` values. Treat
   any older or unknown schema version and invalid JSON as a full re-detection.
5. Write the version-9 result to that same cache path and stop.

## Assess the change

Read `config.md` before using cached values.

1. Identify the runtime as Claude Code, Codex, or OpenCode and select only its cache:
   `.claude/ship.local.json`, `.codex/ship.local.json`, or
   `.opencode/ship.local.json` respectively, inside the
   repository's main worktree. `config.md` gives the exact lookup.
2. If that cache contains valid schema version 9 for the current host, use it.
   If it is missing, invalid, an older version, another version, or records
   another host, run complete detection and overwrite only the selected cache.
   Never read the other host's cache.
3. On first detection, tell the user which cache was written and how to refresh
   it: `/ship-config` in Claude Code or OpenCode, or `$ship refresh config` in Codex.
4. Read live state that must never be cached: the **live project facts** in
   `config.md` (`qualityGates` and `tasks.tasksFile`, from the current worktree),
   `git status`, the diff against the base branch, the current branch, worktree
   state, and which tracked task this session's change implements.

Give the user a one-line execution summary, naming any step the caller asked to
skip, then run the steps in order. If a
cached command or helper is no longer valid, fix the route for this run and tell
the user to refresh the config afterward.

## 1. Rebase onto the base branch

Bring the change up to date with its base before verifying it, so the gates and
the review loop judge the change as it will land. Invoke the `rebase` skill
bundled with this plugin — `ship:rebase` through the Skill tool in Claude Code,
`$rebase` in Codex — saying that the working-tree change is the change being
shipped (it may stash and restore it) and that this workflow runs the gates and
a working-tree review next, so it skips its gates and reviews only conflict
resolutions in rebased commits. If the skill cannot be invoked, read
`../rebase/SKILL.md` relative to this file and follow it directly.

It reuses the config already loaded here. When it reports a large impact and
asks the user how to adapt, or stops on a review finding that blocks it, wait
for the answer before continuing.

## 2. Pass quality gates

Skip this step under `--skip-gates` unless the skip has lapsed (see the inputs
above).

When step 1 moved the branch, re-read the **live project facts** first: the
base's new commits can add, rename, or drop a gate command.

Run every non-null command under `qualityGates`, using the exact command just read.
Run type-check, tests, build, and lint when present. A successful gate already run
against identical code in this session need not be repeated.

Fix failures and rerun affected gates until green. If code changes later in the
workflow, rerun every gate that could be affected.

## 3. Review the local diff

Skip this step under `--skip-review` unless the skip has lapsed (see the inputs
above).

This step reviews the working change and runs before any commit or pull request.
Invoke the `review-fix-loop` skill bundled with this plugin —
`ship:review-fix-loop` through the Skill tool in Claude Code, `$review-fix-loop`
in Codex — scoped to the working tree while the change is uncommitted, or once it
is committed to `git diff <target>...HEAD`, where `<target>` is the target ref
the rebase in step 1 resolved (`<remote>/<base>` when a GitHub remote exists).
A local base branch can be missing or stale, which would pull upstream commits
into the review. If the skill
cannot be invoked, read `../review-fix-loop/SKILL.md` relative to this file and
follow it directly.

It reviews the change with `review-changes`, fixes the warranted findings, and
re-reviews each round of fixes — widening the review to code a fix could affect
— until it converges or reaches its round cap. A critical or important finding
it leaves open blocks this workflow: stop and put it to the user. A missing pull
request is never a reason to skip the review.

## 4. Complete a tracked task

When `tasks.tasksFile` is set and the current change clearly implements one task:

- Invoke the exact `skills.taskCompletion` helper when set. For
  `tasks:task-tracking` (or `task-tracking` in OpenCode), request its
  **Mark a task started or done** operation.
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

## 5. Publish when a GitHub remote exists

Follow this path only when `environment.hasGitHubRemote` is true.

1. If currently on `environment.defaultBranch`, create a feature branch before
   committing. Never commit the change directly on the default branch.
2. Rebase again with the `rebase` skill, as in step 1, so a base that moved
   during the review loop is integrated before the pull request opens — but
   this time let it run its own verification: its gates and its review of any
   conflict resolution or adaptation are the last checks before publishing. It
   stops at once when the branch is already current.
3. If `skills.publishing` is set, invoke that exact helper. Otherwise stage the
   intended files, commit with a clear imperative summary and rationale, push
   with upstream tracking, and create a concise PR with `gh pr create`.
   Commit any adaptations the rebase left uncommitted along with the change.
   When the branch was already pushed and a rebase in this run rewrote its
   commits, a plain push is rejected: push it yourself with
   `git push --force-with-lease --force-if-includes` before invoking a
   publishing helper, and never let a helper retry with a bare `--force`.
4. Honor repository and user commit conventions. Do not stage unrelated changes.
5. Record whether the resulting pull request is a draft. In particular,
   `github:yeet` normally creates a draft; that is an intermediate state, not the
   end of this workflow.

Continue immediately to stabilization. Do not stop merely because a publishing
helper returned a pull-request URL.

## 6. Drive the pull request to green

Hand the pull request just published to the `drive-pr` skill bundled with this
plugin — `ship:drive-pr` through the Skill tool in Claude Code, `$drive-pr` in
Codex — with its number and `--mark-ready`, since a draft from step 5 is this
workflow's intermediate state rather than the user's choice. It watches checks,
rebases with the `rebase` skill when the branch falls behind, reviews every fix
with the `review-fix-loop` skill before pushing it, and replies to and resolves
review threads. If the skill cannot be invoked, read `../drive-pr/SKILL.md`
relative to this file and follow it directly.

It reuses the config already loaded here. Never merge the pull request.

## 7. Integrate linearly when no GitHub remote exists

Follow this path only when `environment.hasGitHubRemote` is false:

1. Create a feature branch if currently on the default branch, then commit the
   intended change.
2. Rebase the feature branch onto the default branch with the `rebase` skill.
   Unlike step 1, the change is committed now, so say the working tree holds
   no part of it, and let the skill run its own verification. It fetches first when the
   default branch tracks a remote, and it reruns every gate and reviews any
   conflict resolution or adaptation. Commit any adaptations it left
   uncommitted.
3. Fast-forward the default branch to the rebased feature branch with
   `git merge --ff-only`. If the default branch is checked out in another
   worktree, stop and explain instead of forcing the operation.

Report the resulting default-branch commit.

## Finish

Summarize the rebases (upstream commits integrated, impact, and any adaptation),
the gates that passed, review outcome (the reviewers run with their models,
the re-review rounds and their scopes, findings fixed and declined), task
updates, and publication result. For
GitHub, include the PR URL, green status, the review threads replied to and
resolved, and whether it was marked ready for review; remind the user that the
final merge remains theirs. For no-remote integration, include the resulting
commit. Call out anything skipped and why — including steps skipped at the
caller's request, and any requested skip that lapsed and what made it lapse. Close by noting that `/codex:review`
or `/code-review` remain available for a second opinion the user runs
themselves; never run them from this workflow.
