---
name: review-changes
description: >-
  Review a local code change with specialized reviewer agents: work out the
  change's scope and shape, pick the reviewers that apply (bugs, security,
  error handling, tests, conventions, types, docs), choose each one's model,
  run them in parallel, and merge their findings into one report. Use when the
  user invokes /review-changes, asks to review uncommitted work, "what I just
  changed", or a branch's diff before a pull request exists. The
  review-fix-loop skill runs it for every review it makes, including ship's,
  drive-pr's, and rebase's. Reports only; never edits or posts.
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
- **Context** (optional) — unchanged files or symbols outside the scope that
  the change may affect, each with the reason, such as "calls `parseConfig`,
  which now returns null on empty input". `review-fix-loop` passes these when a
  fix changed a contract other code relies on. Reviewers read them to judge the
  scope's effect; they are not part of the change.
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
- note the size bucket (small, normal, large), counting the scope only, not
  its context;
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
  typo-level CI fix does not need the strongest model. A scope that comes
  with **Context** changed a contract by definition; never lower it.
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
- the context files, when given, each with its reason;
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
Scope: <scope> (<size>, <n> files) — context: <files, when given>
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

This workflow stops at the report. A caller that fixes what it found — the
user asking for fixes, or `ship`, `drive-pr`, and `rebase` — uses the
`review-fix-loop` skill bundled with this plugin, which runs this workflow for
the first review and for every re-review, and decides how far each round of
fixes reaches.

## Codex

This workflow is built for Claude Code's subagents and per-agent models; Codex
support is a later change. Until then, in Codex: read `../ship/config.md`
relative to this file and use the current host's cache as it describes —
reusing what a calling workflow already loaded — then invoke the exact
`skills.localReview` skill when the cache records one and it is not this
skill (a cache that records `review-changes` is wrong; ignore it and tell the
user to refresh the config), scoped as above, with any context in the
request. That skill may not take context, so then review the context files
yourself against the same checklists as below, and merge what you find into
its report. Otherwise critically review the scope yourself against the focus
of each reviewer **3. Select reviewers and models** would choose, reading their
agent files in `../../agents/` as checklists, and report in the format
above.
