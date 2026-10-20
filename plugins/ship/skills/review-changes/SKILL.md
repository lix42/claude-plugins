---
name: review-changes
description: >-
  Review a local code change with specialized reviewer agents: work out the
  change's scope and shape, pick the reviewers that apply (bugs, security,
  error handling, tests, conventions, types, docs), choose each one's model,
  run them in parallel, and merge their findings into one report. Use when the
  user invokes /review-changes, asks to review uncommitted work, "what I just
  changed", or a branch's diff before a pull request exists. Ship, drive-pr,
  and rebase use it for every review. Reports only; never edits or posts.
allowed-tools: Read, Bash, Glob, Grep, Task
---

# Review changes

Orchestrate a review of one local change. This workflow decides **who** reviews
and **on which model**; the reviewer agents decide **what** is wrong. It
reports findings and never edits files, commits, pushes, or comments on GitHub
— the caller acts on the report (see **Acting on the report**).

Inputs, from the user or the calling workflow:

- **Scope** — the working tree, the diff against a base (`<base>...HEAD`), a
  commit range, or both a range and the working tree. When none is given,
  derive it under **1. Resolve the scope**.
- **Focus** (optional) — why this review runs, such as "a CI fix for the
  failing lint job" or "conflict resolutions from a rebase". Pass it to every
  reviewer so they judge the change against its intent.
- **Reviewers** (optional) — a caller or user may name reviewers to run or
  skip, and may pin a model. Honor that over the selection rules below.

Never route this review through `/code-review` or `/codex:review`. Both are
user-invocable only, and `/code-review ultra` is a billed cloud review reserved
for the user. Mention them in the report as a second opinion the user can run.

## 1. Resolve the scope

Use the caller's scope verbatim. Otherwise:

1. Run `git status --short -uall`, `git diff --stat`, and
   `git diff --stat --staged`. `-uall` lists each untracked file, where plain
   `--short` folds a new directory into one `dir/` line.
2. If the working tree or index has changes, the scope is the working tree:
   `git diff` plus `git diff --staged`, and every untracked file `git status`
   lists.
3. Otherwise find the base — the current branch's pull-request base
   (`gh pr view --json baseRefName`), else the default branch
   (`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`, else the
   remote HEAD, else `main`). Diff against the remote's copy of it: fetch the
   remote that hosts it (the one `gh repo view` targets, usually `origin`) and
   use `git diff <remote>/<base>...HEAD`. A local `<base>` may be missing in a
   worktree, or stale enough to pull upstream commits into the scope; use it
   only when no remote has the branch.
4. If both are empty, say there is nothing to review and stop.

Write down the exact git commands that produce the scope, and list the
untracked files in it by path: no `git diff` command shows their content, so
reviewers read them whole. Every reviewer gets the same commands and list, so
they all review the same change.

## 2. Profile the change

Read `reviewers.md` beside this file — the registry of reviewers, their
triggers, default models, the signals, and the scope-size buckets. Then, from
`git diff --stat` and the diff itself — counting untracked files in a
working-tree scope too (`wc -l` each), which `--stat` leaves out:

- list the changed files and classify each: source, test, executable prose,
  documentation, config, lockfile, generated or vendored;
- note the size bucket (small, normal, large);
- note which signals the added and removed lines carry;
- find the project instruction files that apply (`CLAUDE.md` at the repository
  root and in the changed files' directories, `AGENTS.md` likewise).

## 3. Select reviewers and models

**OpenCode:** use the registered `ship/review-*` agents with the `subagent`
tool, not Claude's Task tool. Unless the user explicitly requests a model,
omit per-call model overrides: inherit the agent's configured model (or the
parent model). The Opus/Sonnet rules below apply only to Claude Code. Users may
configure OpenCode reviewer models with the integration's `models` option.

Start from the registry's **Runs when** column, then apply these rules:

- **Always at least one.** A non-empty scope with code, executable prose, or
  config gets `review-bugs` — config such as CI workflows, `package.json`
  scripts, build, compiler, or lint settings changes behavior as surely as
  code. A scope of documentation only gets `review-docs` alone. Lockfiles are
  not config here; the lockfile rule below decides them.
- **Small scope.** Run `review-bugs` plus each reviewer whose signal the diff
  clearly carries. Skip `review-conventions` and `review-tests` unless the fix
  touches tests or adds behavior that needs one.
- **Generated and vendored changes** need no reviewer; say so. A lockfile-only
  change gets `review-security` when it adds, removes, or changes the source of
  a dependency, since that is a supply-chain change; one that only reorders or
  re-hashes needs no reviewer.
- **Caller's choice wins.** Add, drop, or pin reviewers the caller named.

Pick each reviewer's model. Leave it at the default unless a rule applies, and
pass an override with the Task tool's `model` parameter:

- **Lower an opus reviewer to sonnet** when the scope is small and contains no
  concurrency, security, persistence, or cross-module contract change — a
  typo-level CI fix does not need the strongest model.
- **Raise a sonnet reviewer to opus** when its area is the heart of a large or
  subtle change: `review-types` on a new public API or data model,
  `review-error-handling` on transactions, retries, or partial-failure paths,
  `review-tests` on a change whose correctness rests on its tests.
- **Use haiku** only for a reviewer whose registry default is haiku. Judging
  whether code is correct needs more than haiku gives.

Give the user one line before launching: the scope, its size, and each reviewer
with its model, marking overrides — for example
`Reviewing working tree (normal, 9 files): review-bugs (opus), review-tests
(sonnet), review-docs (sonnet), review-conventions (sonnet)`.

## 4. Launch in parallel

Launch every selected reviewer in one message, as `ship:<agent>` subagents with
the Task tool in Claude Code, or `ship/<agent>` with the `subagent` tool in
OpenCode, so they run concurrently. Give each the same brief:

- the path to `reviewer-contract.md` beside this file, which it must read first;
- the scope and the exact git commands that produce it, plus the untracked
  files in it, to be read whole;
- the changed files, marking the ones its focus most concerns;
- the project instruction files to read;
- the caller's focus, when given.

In OpenCode, the reviewer contract is already embedded in each registered
reviewer's system instructions: do not ask them to read its packaged path again.
Include the actual scoped diff inline, or a diff-file path inside the project or
an already-approved directory, in each brief: reviewer agents deny shell execution
as well as editing. They use read/glob/grep to inspect the diff, complete files, and callers.
If the diff is too large, provide focused diff files without omitting any part
of the selected scope across the reviewers.

## 5. Merge the findings

When every reviewer has returned:

1. **Collect.** A reviewer that failed or returned something outside the
   contract counts as skipped; name it in the report, and rerun it once when
   its area matters to the change. When a reviewer still cannot run — or none
   can be launched at all, as when the plugin's agents are not registered or
   the Task tool is unavailable — review its area yourself against its agent
   file in `../../agents/`, read as a checklist, and say in the report which
   areas were self-reviewed. Never report a scope as clean because its
   reviewers failed.
2. **Deduplicate.** Findings at the same location with the same root cause are
   one finding; keep the clearest wording and list every reviewer that raised
   it. Overlap between reviewers is corroboration, not noise.
3. **Check what conflicts.** When two reviewers contradict each other, or a
   finding's claim is cheap to check against the code, check it and drop
   what the code disproves. Otherwise pass findings through — the caller
   investigates each one.
4. **Group by severity**, critical first.

## 6. Report

```
Scope: <scope> (<size>, <n> files)
Reviewers: review-bugs (opus), review-tests (sonnet), … — skipped: <name and why>

## Critical
1. [review-bugs, review-security] <summary> — path/to/file.ts:123
   Problem: …
   Fix: …

## Important
…

## Minor
…

## Notes
<reviewers' below-bar notes worth keeping, and files any reviewer did not read>

For a second opinion, run /codex:review or /code-review yourself.
```

Omit empty severity sections. With no findings at all, say so in one line under
the `Reviewers` line.

## Acting on the report

This workflow stops at the report. A caller that fixes what it found — `ship`,
`drive-pr`, `rebase`, or the user asking for fixes — works through it this way:

1. **Snapshot the reviewed state** before editing anything, so the fixes can
   be told apart from the change they fix — no git command can when both sit
   uncommitted in the same working tree. Record the working tree as a tree
   object through a throwaway copy of the index, which leaves the real index
   untouched. Seeding the copy keeps tracked files that match `.gitignore`:

   ```bash
   idx="$(mktemp -d)/index"; src="$(git rev-parse --git-path index)"; { [ ! -e "$src" ] || cp "$src" "$idx"; } && GIT_INDEX_FILE="$idx" git add -A && GIT_INDEX_FILE="$idx" git write-tree
   ```

   Keep the printed SHA as `<before>`. If the command fails or prints nothing,
   fix the cause and rerun it; never fall back to an empty index, which drops
   tracked files that match `.gitignore` and makes the later diff show them
   as changes.
2. Investigate every finding. Fix the warranted ones and state why any is
   declined.
3. Rerun the quality gates the fixes could affect.
4. Re-review only the fixes. Run the same command again for `<after>`, and
   invoke this workflow with `git diff <before> <after>` as the scope and, as
   **Reviewers**, the reviewers whose findings were fixed — plus `review-bugs`
   whenever a fix changed code or executable prose, since a fix for any
   finding can introduce a bug.
5. For a second round, take `<after>` as the new `<before>` and repeat from
   step 2. Stop after two re-review rounds rather than looping.
6. **Open findings block.** A critical or important finding still open after
   the last round — neither fixed nor declined with a reason — blocks the
   caller's next commit, push, or publish. Stop and put it to the user with
   what was tried. Open minor findings do not block; list them in the
   caller's summary.

## Codex

This workflow is built for Claude Code's subagents and per-agent models; Codex
support is a later change. Until then, in Codex: read `../ship/config.md`
relative to this file and use the current host's cache as it describes —
reusing what a calling workflow already loaded — then invoke the exact
`skills.localReview` skill when the cache records one and it is not this
skill (a cache that records `review-changes` is wrong; ignore it and tell the
user to refresh the config), scoped as above;
otherwise critically review the scope yourself against the focus of each
reviewer **3. Select reviewers and models** would choose, reading their agent
files in `../../agents/` as checklists, and report in the format above.
