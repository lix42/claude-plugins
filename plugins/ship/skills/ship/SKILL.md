---
name: ship
description: >-
  Take a finished coding change from "done writing code" to "ready to merge."
  Use this when the user runs /ship, or says they've finished a task and want to
  ship / wrap up / open a PR / get it reviewed and merged. Runs the project's
  quality gates (type-check, test, build), gets the change code-reviewed, updates
  CLAUDE.md, marks the task done in docs/TASKS.md, then either opens a GitHub PR
  and drives it to green, or (when there's no remote) rebases and merges back to
  the main branch with linear history.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, Skill
---

# Ship

Carry a finished change through the last mile: verify it, review it, document it,
and get it into review/merge. The user ran `/ship` (or asked to ship), so the
outward actions here — pushing, opening a PR — are authorized; you don't need to
ask permission for each one. Two hard rules:

- **Never proceed past a failing quality gate.** A red type-check/test/build is a
  stop sign — fix it, don't ship around it.
- **Don't merge a GitHub PR.** Get it green and address feedback, then hand back
  so the user does the final merge (respects branch protection / required review).
  (The no-remote local-merge path in Step 7 is the one exception, and it's the
  whole point of that path.)

Throughout, **prefer an available specialized skill/subagent over doing it by
hand** — check the session's available skills and commands and use the named ones
when present. They appear in your available-skills list; treat a name as
"available" only if it's actually there.

## Assess first

Before touching anything, get your bearings (don't narrate every command — just
gather what you need):

- **What changed:** `git status`, and the diff vs. the base branch.
- **Branch state:** current branch; the repo's default branch
  (`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`, or
  `git remote show origin`); whether you're a worktree.
- **Remote:** is there a GitHub remote? (`git remote -v`, `gh repo view`). This
  decides Step 5/6 (PR) vs. Step 7 (local merge).
- **Project commands:** read `package.json` scripts, a `Makefile`, and the
  Commands section of `CLAUDE.md` to learn how this project type-checks/tests/builds.
- **Task context:** does `docs/TASKS.md` exist, and which task did this session
  work on?

Give the user a one-line plan, then execute the steps in order.

## Step 1 — Quality gates

Run the project's checks and get them green. Discover what exists rather than
assuming — common shapes: `package.json` scripts named `typecheck`/`type-check`/
`tsc`, `test`/`test:run`, `build`, `lint`; `Makefile` targets; or commands
documented in `CLAUDE.md`.

- Run **type-check, tests, and build** if the project has them. Prefer
  **single-run / CI variants** over watch mode (e.g. `test:run`, not `test`). Run
  `lint` too if present. Note that some commands subsume others (a `build` of
  `tsc -b && vite build` already type-checks).
- If you already ran a given check successfully against the current code in this
  session and nothing has changed since, you may skip re-running it.
- **Fix every failure** and re-run until clean. Do not continue to Step 2 with a
  red gate. If a failure is genuinely pre-existing and unrelated to this change,
  say so explicitly and let the user decide rather than silently ignoring it.

## Step 2 — Code review

Get the local change reviewed and act on the findings.

- If **`pr-review-toolkit:review-pr`** is available, use it to review the current
  change.
- Else, if another review skill or subagent is available (e.g. a `/code-review`
  skill, or a `code-reviewer` subagent via the Task tool), use that.
- Else, **self-review**: re-read the diff critically for correctness, edge cases,
  security, and project-convention violations.

Address what the review surfaces — fix real issues, and for anything you
consciously decline, note why. Re-run the relevant quality gate if you changed code.

## Step 3 — Update documentation

Keep `CLAUDE.md` honest about how the project now works.

- If **`claude-md-management:revise-claude-md`** is available, use it.
- Else, review what was learned this session — new commands, conventions,
  gotchas, structural changes — and update `CLAUDE.md` accordingly. Be judicious:
  record durable, non-obvious facts that help future work; don't bloat it with
  one-off detail or things the code already makes clear. If nothing meaningful
  changed, it's fine to update nothing — say so.

## Step 4 — Mark the task done

If `docs/TASKS.md` exists and this session was working on one of its tasks, mark
that task complete.

- If the **`tasks:tasks-done`** command/skill is available, use it (it also reports
  what the completion unblocks).
- Else, edit `docs/TASKS.md` directly: set the task's checkbox to `[x]`.
- Identify the task from the session's work (branch name, files touched, the
  task's stated goal). If which task is ambiguous, ask rather than guessing.
- If there's no `docs/TASKS.md`, or the work wasn't a tracked task, skip this step.

## Step 5 — Commit and open a PR (GitHub remote)

Only when there's a GitHub remote. (No remote → Step 7.)

- **Branch first if needed.** If you're on the default branch, create a feature
  branch before committing — never commit the change directly onto `main`.
- If **`commit-commands:commit-push-pr`** is available, use it.
- Else: stage and commit with a clear message (imperative summary + why), push the
  branch with upstream tracking, then open the PR with `gh pr create` (concise
  title; body covering what changed and why, and linking the task if there is one).
- Follow any commit-message / co-author conventions the user's global or project
  config defines.

## Step 6 — Drive the PR to green

Monitor the PR and keep working it until checks pass and feedback is handled. Poll
until checks finish — don't just fire-and-forget.

- **Watch checks:** `gh pr checks --watch` (or poll `gh pr checks` / `gh pr view
  --json statusCheckRollup`). This can take several minutes; wait it out.
- **On a failing check:** open the failing job's logs (`gh run view --log-failed`),
  reproduce and fix locally, commit, push, then re-watch. Loop until green or
  genuinely stuck — if stuck, stop and explain what's blocking.
- **If the branch is behind the base:** when the PR is out of date with the
  default branch (`gh pr view --json mergeStateStatus` shows `BEHIND`, or checks
  won't settle because of it), `git fetch origin` and **rebase onto the default
  branch**, re-run quality gates (the base moved), then force-push
  (`--force-with-lease`) and re-watch.
- **Review comments:** read them (`gh pr view --comments`, and review threads via
  `gh api`). Evaluate each on its merits — push back with reasoning when you
  disagree (don't just comply). Make the changes that are warranted, push, and
  **reply to each thread** saying what you did or why you didn't.
- **Stop when green and comments are addressed.** Report the PR URL and status;
  leave the final merge to the user.

## Step 7 — No remote: rebase and merge locally

When there's no GitHub remote, integrate the change into `main` yourself, keeping
history linear (other worktrees may be building on `main` in parallel).

- Commit the change on the feature branch (branch first if you're somehow on
  `main`).
- **Rebase onto `main`** so the branch sits directly on top of the latest `main`
  (`git fetch` if `main` tracks anything; then `git rebase main`). Resolve any
  conflicts.
- **Re-run the Step 1 quality gates** after the rebase — `main` may have moved
  under you — and fix anything that broke.
- **Fast-forward `main`** to the rebased branch (`git checkout main && git merge
  --ff-only <branch>`), which keeps history linear. If `main` is checked out in
  another worktree and can't be checked out here, tell the user rather than
  forcing it.
- Report the resulting `main` commit.

## Finishing up

End with a short summary: which gates ran and passed, how the review went, whether
CLAUDE.md / the task list changed, and the outcome — PR URL + check status (Step
6) or the new `main` commit (Step 7). Call out anything you skipped and why, and
anything left for the user (e.g. the final PR merge).
