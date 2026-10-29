---
name: start-task
description: >-
  Start work on a task from the docs/tasks plan: read the task and its context
  from the current checkout, explain it in plain English, draft a plan, and
  answer the user's questions — then, only once the user says go, create a
  branch named after the task from the remote default branch, add a worktree
  for it (under .worktrees/ when on the default branch, otherwise a sibling of
  the checkout), switch the session into it, check the worktree matches what was
  read, and interview the user about anything still unclear. Started from the
  default branch, it first marks the task in progress there in a local-only
  commit, so the next start-task from that checkout doesn't offer it again. Checks for an
  existing branch, folder, or worktree first and asks how to proceed instead of
  clobbering anything. Use when the user invokes /tasks:start-task or
  $start-task, or asks to start/pick up a specific task in a new worktree.
argument-hint: <task-name>
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash, AskUserQuestion, EnterWorktree
---

# Start a task

Understand one task, let the user decide whether to start it now, then set up an
isolated worktree for it and get to an agreed plan. The user has already chosen
the task — do not run the "what's next" query or second-guess the choice.

The order matters: brief first, worktree second. The user may change their mind
after reading the brief, and often has questions about the plan — so nothing is
created until they say go, and their questions are answered before the
interview.

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
| Branch (`$BRANCH`) | `parser` | `app/state` |
| Folder name (`$NAME`) | `parser` | `app-state` |

Where the folder goes depends on the branch the current checkout is on.
`<root>` is the top level of the current checkout:

- **On the default branch** (e.g. `main`) — `$FOLDER` is
  `<root>/.worktrees/<folder name>`, inside the checkout and gitignored.
- **On any other branch, or detached HEAD** — `$FOLDER` is
  `<root>/../<folder name>`, a sibling of the checkout.

The default branch comes from `$BASE`, so settle `$FOLDER` in step 2. Normalize
it with `pwd -P` semantics (resolve symlinks, e.g. `/tmp` → `/private/tmp` on
macOS) before comparing it to anything git reports.

If the task's status is already `done` or `closed`, mention it and ask before
continuing.

## 2. Preflight — look before creating anything

Run these and collect the facts; create nothing yet.

```bash
git fetch origin --prune
BASE=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)
git rev-parse --verify --quiet "$BASE"            # base must exist
ROOT=$(cd "$(git rev-parse --show-toplevel)" && pwd -P)
if [ "$(git branch --show-current)" = "${BASE#origin/}" ]; then
  FOLDER="$ROOT/.worktrees/$NAME"                  # on the default branch
else
  FOLDER="$(cd "$ROOT/.." && pwd -P)/$NAME"         # elsewhere: sibling
fi
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

Keep these facts for the brief (step 3) and the decision (step 5). Don't ask
about them yet.

## 3. Read and brief — from the current checkout

Read from the current checkout (`$ROOT`), following the task-tracking skill's
reading rules. If the task exists only on the remote (step 1), read the task
file — and any other plan file the checkout lacks — with
`git show "$BASE:<path>"` instead.

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

**Record every path you read** and where it came from (checkout or `$BASE`) —
step 9 compares them against the worktree.

If an existing branch or worktree from step 2 is likely to be reused and already
carries work for this task, look at that work too (`git log "$BASE..$BRANCH"`,
`git diff --stat "$BASE...$BRANCH"`) — it changes what is left to do.

Then reply with:

1. **In plain English** — what the task is and why it exists, what it touches,
   and what "done" looks like (from How to Verify). Short, no jargon the task
   file doesn't force.
2. **Plan** — concrete steps: files to change or add, the order, and how each
   step is verified. Flag where it departs from the task file's Design and why.
   Push back if the spec looks wrong or conflicts with the code or progress log.
3. **Setup** — one or two lines on what step 2 found: the branch and folder that
   will be created, or what already exists (e.g. "branch `parser` exists, 3
   commits ahead of origin/main, 12 behind; no worktree"). On the default
   branch, add that go also commits the local in-progress marker (step 6).

## 4. Gate — wait for go

End the reply with a plain question, not `AskUserQuestion` — the user should be
free to type questions:

> Does this sound right? Ask anything about the plan, or say **go** to create the
> worktree (or **stop**).

Then end the turn and wait.

- **Questions** — answer them, grounded in what you read (read more if needed).
  If an answer changes the plan, show the revised parts. Ask again; repeat until
  the user says go or stop.
- **Plan changes** — revise the plan, show what changed, ask again.
- **Stop** — nothing was created; say so and end.
- **Go** — continue to step 5. Remember what was already settled here so step 10
  doesn't ask it again.

## 5. Decide

If the gate took a while, re-run the step 2 checks (skip the fetch) — the user
may have created or removed things meanwhile.

If **none** of branch, remote branch, folder, or worktree exists, go straight to
step 6, then step 7's default action. Otherwise present what you found,
plainly — e.g. "branch `parser` exists (3 commits ahead of origin/main, 12
behind); no worktree; folder `.worktrees/parser` doesn't exist" — and ask with `AskUserQuestion`, offering only
the options that fit. Always include **Stop**.

Check the situations in this order; the first match decides:

1. **Worktree registered at `$FOLDER`, folder present.**
   - *Use it* — go to step 8 with that worktree. If it's on a different branch
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
   - *Use that worktree* — go to step 8 with its path.
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

If the user picks Stop, stop — summarize what exists and end. Any other answer
runs step 6 before the command it chose.

## 6. Mark the task in progress on the default branch

Only when the current checkout is on the default branch (`${BASE#origin/}`) and
the task file exists in the checkout with status `todo`. Skip it otherwise: on
another branch, a task found only on the remote (step 1), no task file, or a
status already `doing` (a re-run of start-task) — say why in one line.

This commit stays local. It keeps the task from showing as ready the next time
the user runs start-task or `tasks next` from this checkout, while the work
happens on the task branch. The worktree is still created from `$BASE`, so the
marker never reaches the task branch or its PR.

1. If anything in the plan already has uncommitted changes
   (`git status --porcelain -- docs/tasks docs/TASKS.md docs/progress.md docs/progress`),
   ask with `AskUserQuestion`: *Skip the marker* or *Stop*. `docs/TASKS.md` is
   regenerated from the whole plan, header included, so any such edit would end
   up in the marker commit. Never fold the user's edits into it.
2. Run `tasks set <id> status=doing`. The paths it changed are the ones
   `git status --porcelain` lists now under those plan paths (the task file and
   `docs/TASKS.md`, at least) — never files outside the plan.
3. Commit only those paths, leaving anything else staged or unstaged as it was:

   ```bash
   git commit -m "tasks: mark <id> in progress [local]" \
     -m "Local marker: never push it. Drop it once the task is done by syncing the default branch from $BASE (git reset --keep $BASE when only [local] commits are ahead)." \
     -- <changed paths>
   ```

   Keep the subject exactly in this form: `/sync` recognizes `[local]` markers
   by it and drops them once `$BASE` has caught up.
4. Never push the default branch here. If the commit fails, show the error, put
   the status back (`tasks set <id> status=todo`), and ask whether to continue
   without the marker or stop.

A default branch carrying a marker no longer fast-forwards to `$BASE`; dropping
markers is the sync's job, not this skill's. Integrating a task branch by
rebasing onto the local default branch (ship's no-GitHub-remote path) would
carry the marker along — mention it if that is how the repo ships.

## 7. Create the worktree (default action)

When `$FOLDER` is under `<root>/.worktrees/`, first make sure git ignores it.
Do this before **any** `git worktree add`, including the ones in step 5:

```bash
git -C "$ROOT" check-ignore -q ".worktrees/$NAME"  # already ignored?
```

If it isn't ignored, append `/.worktrees/` on its own line to
`<root>/.gitignore`, creating the file if needed (add a newline first if the
file doesn't end with one). Don't commit the change. Tell the user that
`.gitignore` was changed so they can commit it.

```bash
git worktree add --no-track -b "$BRANCH" "$FOLDER" "$BASE"
```

`--no-track` matters: branching from `origin/main` would otherwise set the new
branch's upstream to `main`, and a bare `git push` could go there. The branch
gets its own upstream on its first `git push -u`.

If any `git worktree add` fails, show the error and stop — don't retry with
`-f` or other flags the user didn't choose.

## 8. Switch into the worktree

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

## 9. Check the worktree matches the reading

The brief was read from the checkout; the work happens in the worktree. They
usually match (start-task typically runs from an up-to-date default branch), but
the checkout may be stale, on another branch, or carry uncommitted edits, and a
reused branch has its own history.

Compare every path recorded in step 3 against the worktree:

```bash
# read from the checkout
git diff --no-index --stat -- "$ROOT/<path>" "$FOLDER/<path>"
# read from $BASE
git -C "$FOLDER" diff --stat "$BASE" -- <path>
```

Also re-run `tasks show <id>` in the worktree — dependency statuses may differ.

When step 6 committed a marker, the task file and `docs/TASKS.md` differ by
that status change alone (`doing` in the checkout, `todo` in the worktree).
That difference is expected; don't report it as a change.

- **No differences** — say so in one line and continue.
- **Differences** — re-read the changed files from the worktree, say what
  changed, and update the plan. If the change is material (a dependency's
  interface moved, the task spec changed, work already exists), show the revised
  plan before the interview.

## 10. Interview and agree

If anything is still genuinely unclear or undecided (scope edges, conflicting
guidance, a choice the spec leaves open) — and wasn't settled at the gate —
interview the user with `AskUserQuestion`: a few sharp questions, each with
concrete options, not a long form. Skip anything you can reasonably infer.

Revise the plan with the answers. **Do not start implementing** until the user
agrees to the plan.

Do not change the task's status in the worktree or write to the progress log
here — that happens when work actually starts (`tasks set <id> status=doing` on
the task branch). Step 6's marker on the default branch is separate and local.
