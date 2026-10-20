---
name: start-task
description: >-
  Start work on a task from the docs/tasks plan in its own git worktree: create a
  branch named after the task from the remote default branch, add a sibling
  worktree for it, switch the session into it, then read the task and its
  context, explain it in plain English, draft a plan, and interview the user
  about anything unclear. Checks for an existing branch, folder, or worktree
  first and asks how to proceed instead of clobbering anything. Use when the
  user invokes /tasks:start-task or $start-task, or asks to start/pick up a
  specific task in a new worktree.
argument-hint: <task-name>
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash, AskUserQuestion, EnterWorktree
---

# Start a task

Set up an isolated worktree for one task and get to an agreed plan. The user has
already chosen the task — do not run the "what's next" query or second-guess the
choice.

This skill **never destroys anything on its own**: no deleting folders, no
resetting branches, no discarding changes without an explicit answer from the
user. When something already exists, stop and ask.

## 1. Resolve the task

The task is in `$ARGUMENTS`. If empty, ask which task.

In OpenCode, take the task from the invoking message or command's user arguments;
`$ARGUMENTS` is a command-template convention, not an environment variable.

Resolve it with the task-tracking CLI
(`node ${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/cli/tasks.ts show <arg> --json`,
or `cli/tasks.ts` in the task-tracking skill's directory where that variable isn't
set): it accepts a unique name or substring and reports ambiguity — if several
match, ask. If the local plan doesn't have it, check the remote copy after the
fetch in step 2 (`git show origin/<default>:docs/tasks/<id>.md`) — the local
checkout may be stale. If it isn't found anywhere, say so and ask whether to
continue with the name as given (worktree only, no task brief) or stop.

Derive the names from the task id:

| | Flat (`parser`) | Epic (`app/state`) |
|---|---|---|
| Branch | `parser` | `app/state` |
| Folder | `<root>/../parser` | `<root>/../app-state` |

`<root>` is the top level of the current checkout, so the new worktree is a
sibling of it. Normalize the folder with `pwd -P` semantics (resolve symlinks,
e.g. `/tmp` → `/private/tmp` on macOS) before comparing it to anything git
reports.

If the task's status is already `done` or `closed`, mention it and ask before
continuing.

## 2. Preflight — look before creating anything

Run these and collect the facts; create nothing yet.

```bash
git fetch origin --prune
BASE=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)
git rev-parse --verify --quiet "$BASE"            # base must exist
git rev-parse --verify --quiet "refs/heads/$BRANCH"          # local branch?
git rev-parse --verify --quiet "refs/remotes/origin/$BRANCH" # remote branch?
git worktree list --porcelain                      # registered worktrees
ls -A "$FOLDER" 2>/dev/null                         # folder exists? empty?
```

If the fetch fails or `$BASE` doesn't resolve, stop and report — don't branch
from a stale or guessed base.

From `git worktree list --porcelain`, determine:

- **W-path** — is a worktree registered at `$FOLDER`? Which branch does it have,
  and is it marked `prunable` (its folder is gone)?
- **W-branch** — is `$BRANCH` checked out in a worktree at some *other* path?

For an existing local branch, also get how it relates to the base:
`git rev-list --left-right --count "$BASE...$BRANCH"` (behind / ahead).

## 3. Decide

If **none** of branch, remote branch, folder, or worktree exists, go straight to
step 4 with the default action. Otherwise present what you found, plainly — e.g.
"branch `parser` exists (3 commits ahead of origin/main, 12 behind); no worktree;
folder `../parser` doesn't exist" — and ask with `AskUserQuestion`, offering only
the options that fit. Always include **Stop**.

Check the situations in this order; the first match decides:

1. **Worktree registered at `$FOLDER`, folder present.**
   - *Use it* — go to step 5 with that worktree. If it's on a different branch
     than `$BRANCH`, say so explicitly in the question. Report its
     `git status --short` and ahead/behind so the user knows what they're
     walking into.
   - *Stop.*
2. **Worktree registered at `$FOLDER`, but prunable (folder deleted).**
   - *Recreate it* — `git worktree add -f "$FOLDER" "$BRANCH"` (reuses the
     existing branch; `-f` overrides the stale registration). If the registered
     branch no longer exists, create it from the base instead:
     `git worktree add -f --no-track -b "$BRANCH" "$FOLDER" "$BASE"`.
   - *Stop.*
3. **`$BRANCH` checked out in a worktree elsewhere.** Git refuses to check one
   branch out twice.
   - *Use that worktree* — go to step 5 with its path.
   - *Stop.*
4. **`$FOLDER` exists but isn't a registered worktree.**
   - If it's **non-empty**: *Use a different folder name* (ask for it, then
     re-run the preflight for that path) or *Stop*. Never delete it.
   - If it's **empty**: *Use the empty folder* (git accepts it) or *Stop*.
     Then continue to the branch checks below for which branch to put in it.
5. **Local branch `$BRANCH` exists, no worktree.**
   - *Use the existing branch* — `git worktree add "$FOLDER" "$BRANCH"`.
   - *Recreate the branch from `$BASE`* — only offer this when the branch has
     **0 commits ahead** of the base; then
     `git worktree add -B "$BRANCH" --no-track "$FOLDER" "$BASE"`. If it has
     unique commits, don't offer it — say those commits would be lost.
   - *Stop.*
6. **Only a remote branch `origin/$BRANCH` exists.** Someone (maybe the user on
   another machine) already pushed work.
   - *Continue the remote branch* —
     `git worktree add --track -b "$BRANCH" "$FOLDER" "origin/$BRANCH"`.
   - *Start fresh from `$BASE`* — the default action below; warn that the local
     branch will diverge from the pushed one.
   - *Stop.*

If the user picks Stop, stop — summarize what exists and end.

## 4. Create the worktree (default action)

```bash
git worktree add --no-track -b "$BRANCH" "$FOLDER" "$BASE"
```

`--no-track` matters: branching from `origin/main` would otherwise set the new
branch's upstream to `main`, and a bare `git push` could go there. The branch
gets its own upstream on its first `git push -u`.

If any `git worktree add` fails, show the error and stop — don't retry with
`-f` or other flags the user didn't choose.

## 5. Switch into the worktree

In OpenCode, use the available `session_move` tool with `directory: "$FOLDER"`
(absolute), omitting `sessionID` to move the current session. If the tool is in
Code Mode, discover it there first. Do not use a shell `cd` as a substitute for
moving the session. When unavailable, use the explicit-path fallback below and
tell the user that the session itself has not moved.

In Claude Code, call `EnterWorktree` with `path: "$FOLDER"` (absolute). This
moves the session into the worktree and reloads that directory's project
instructions and settings — the equivalent of `cd` + starting a fresh `claude`
there. If it's unavailable (Codex) or fails, tell the user, then continue with
every read and command targeting the worktree path explicitly
(`git -C "$FOLDER" ...`, absolute file paths).

Confirm in one line: folder, branch, base commit (`git log -1 --oneline`).

## 6. Brief and plan

Everything below is read **from the worktree**, not the original checkout.

Read, following the task-tracking skill's reading rules:

- The task file — `docs/tasks/<id>.md` — and `tasks show <id>`: its deps with
  their status. Note any dependency not yet `done` — starting a blocked task is
  allowed, but call it out.
- The design in `docs/tasks/_header.md` (the top of `TASKS.md`).
- The task files of its direct dependencies (enough to know the interfaces it
  builds on).
- The progress log: flat mode, all of `docs/progress.md`; epic mode, the whole
  `docs/progress/<epic>.md` plus the `## Epic summary` of each epic it depends
  on. Prior sections carry decisions and gotchas that the spec doesn't.
- `docs/design.md` if TASKS.md links to it for this area, and the code the task
  names (modules, files, types) — enough to ground the plan in what exists.

Then reply with:

1. **In plain English** — what the task is and why it exists, what it touches,
   and what "done" looks like (from How to Verify). Short, no jargon the task
   file doesn't force.
2. **Plan** — concrete steps: files to change or add, the order, and how each
   step is verified. Flag where it departs from the task file's Design and why.
   Push back if the spec looks wrong or conflicts with the code or progress log.
3. **Open questions** — if anything is genuinely unclear or undecided (scope
   edges, conflicting guidance, a choice the spec leaves open), interview the
   user with `AskUserQuestion`: a few sharp questions, each with concrete
   options, not a long form. Skip anything you can reasonably infer.

Revise the plan with the answers. **Do not start implementing** until the user
agrees to the plan.

Do not change the task's status or write to the progress log here — that happens
when work actually starts (`tasks set <id> status=doing`).
