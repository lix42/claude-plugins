---
name: ship
description: >-
  Take a finished coding change from "done writing code" to "ready to merge."
  Use when the user invokes $ship or /ship, asks to ship or wrap up a finished
  change, wants to open a pull request and drive it to green, or asks to refresh
  ship configuration. Run project quality gates, review the diff, update durable
  host-specific project instructions and tracked-task state, then publish and
  stabilize a GitHub PR or integrate linearly when no GitHub remote exists.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, Skill
---

# Ship

Carry a finished change through verification, review, documentation, task
completion, and publication. Invoking this workflow authorizes its normal outward
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
2. Identify the current host and read only that host's cache.
3. Re-detect every field using the documented procedure.
4. Compare fields other than `detectedAt` and report `old → new` values. Treat
   any older or unknown schema version and invalid JSON as a full re-detection.
5. Write the version-3 result to the current host cache and stop.

## Assess the change

Read `config.md` before using cached values.

1. Identify the runtime as Claude Code or Codex and select only its cache:
   `.claude/ship.local.json` or `.codex/ship.local.json` respectively.
2. If that cache contains valid schema version 3 for the current host, use it.
   If it is missing, invalid, an older version, another version, or records
   another host, run complete detection and overwrite only the selected cache.
   Never read the other host's cache.
3. On first detection, tell the user which cache was written and how to refresh
   it: `/ship-config` in Claude Code or `$ship refresh config` in Codex.
4. Read live state that must never be cached: `git status`, the diff against the
   base branch, the current branch, worktree state, and which tracked task this
   session's change implements.

Give the user a one-line execution summary, then run the steps in order. If a
cached command or helper is no longer valid, fix the route for this run and tell
the user to refresh the config afterward.

## 1. Pass quality gates

Run every non-null command under `qualityGates`, using the cached exact command.
Run type-check, tests, build, and lint when present. A successful gate already run
against identical code in this session need not be repeated.

Fix failures and rerun affected gates until green. If code changes later in the
workflow, rerun every gate that could be affected.

## 2. Review the local diff

This step reviews the working change and runs before any commit or pull request.
A missing pull request is never a reason to skip a configured reviewer.

Run every configured reviewer, in parallel when more than one applies. Launch
`review.codexCommand` as a background Bash job first, then invoke the local
review skill, then collect the Codex output.

- **`skills.localReview`.** Invoke that exact skill on the current local change.
  In Claude Code this is normally `pr-review-toolkit:review-pr`, which is the
  preferred local reviewer: it scopes itself from `git status` and `git diff` and
  reviews uncommitted work. Its name means pre-PR review, not "requires an open
  GitHub PR". Never downgrade it to a self-review because no pull request exists.
- **`review.codexCommand`.** When set, run it verbatim with Bash for an
  independent Codex review of the same local change. This is the programmatic
  form of `/codex:review`, which is user-invocable only and therefore cannot be
  called as a skill. Append `--base <environment.defaultBranch>` when the change
  is already committed rather than sitting in the working tree. Treat a Codex
  failure — missing CLI, auth error, non-zero exit — as a skipped reviewer:
  report it and continue with the rest of the review.

Critically self-review the whole diff for correctness, edge cases, security,
error handling, and project conventions only when neither reviewer is configured.

Investigate every finding from every reviewer, deduplicating overlap. Fix
warranted issues and state why any finding is declined. Rerun affected quality
gates after changes.

## 3. Update durable project instructions

Use `instructions.file` as the only candidate:

- In Claude Code, if `skills.documentation` is set, invoke that exact helper for
  the existing applicable `CLAUDE.md`; otherwise review it directly.
  `claude-md-management:revise-claude-md` is the preferred helper — when it is
  configured, do not hand-edit `CLAUDE.md` instead of invoking it.
- In Codex, review the existing applicable `AGENTS.md` directly. There is no
  required documentation helper.

Add only durable, non-obvious commands, conventions, gotchas, or structural facts
learned from the change. Do not create an instruction file, expand one with
one-off implementation details, or update the other host's instruction format.
It is correct to make no documentation edit.

## 4. Complete a tracked task

When `tasks.tasksFile` is set and the current change clearly implements one task:

- Invoke the exact `skills.taskCompletion` helper when set. For
  `tasks:task-tracking`, request its **Mark a task done** operation.
- Otherwise update the task checkbox in `docs/TASKS.md` and close out the matching
  section in `docs/progress.md` directly, including the landed approach,
  verification, and notes for dependent tasks.

Identify the task from the task goal, branch, diff, and session context. Ask the
user if multiple tasks remain plausible. Skip when there is no task file or the
change is not tracked.

## 5. Publish when a GitHub remote exists

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

## 6. Drive the pull request to green

Loop until checks pass, the branch is current, and actionable review feedback is
handled:

1. **Checks.** Watch with `gh pr checks --watch` or inspect
   `statusCheckRollup`. If checks fail and `skills.ciRepair` is set, invoke that
   exact helper. Otherwise inspect failed logs with `gh`, reproduce locally, fix,
   rerun local gates, commit, push, and watch again.
2. **Behind base.** If merge state is `BEHIND`, fetch and rebase onto the remote
   default branch, rerun all quality gates, then push with `--force-with-lease`.
3. **Review feedback.** If `skills.reviewFeedback` is set, invoke that exact
   helper to inspect unresolved threads and implement selected fixes. Otherwise
   use `gh pr view --comments`, `gh api`, or GraphQL as needed to inspect threads.
   Evaluate comments rather than accepting them blindly; make warranted changes,
   reply with what changed or why it did not, and resolve addressed threads when
   appropriate.
4. **Repeat.** Any pushed change restarts check and feedback inspection. Continue
   until green or until a genuine external blocker requires the user.

If the PR is a draft, mark it ready for review only after all checks pass and all
known actionable feedback is addressed (`gh pr ready` is the direct fallback).
Never merge it.

## 7. Integrate linearly when no GitHub remote exists

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

Summarize the gates that passed, review outcome, project-instruction and task
updates, and publication result. For GitHub, include the PR URL, green status,
and whether it was marked ready for review; remind the user that the final merge
remains theirs. For no-remote integration, include the resulting commit. Call out
anything skipped and why.
