---
name: review-fix-loop
description: >-
  Review a local change with the review-changes skill, verify and fix the
  warranted findings, rerun the affected quality gates, then decide how far
  each round of fixes reaches — the fix alone, or also the unchanged code that
  depends on what it changed — and re-review that scope until no findings
  remain or the round cap is reached. Use when the user invokes
  /review-fix-loop, or asks to review and fix, harden, or clean up a change
  before committing it. Ship, drive-pr, and rebase use it for every review.
  Edits the working tree only; never commits, pushes, or posts.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, Skill
---

# Review-fix loop

Carry one local change from "reviewed" to "fixed and re-reviewed." The
`review-changes` skill bundled with this plugin does every review; this
workflow verifies what it reports, fixes the warranted findings, and decides
what the next review must cover. It leaves every fix uncommitted — it never
commits, pushes, or comments on GitHub. The caller, or the user, does that once
the loop ends.

Invoke `review-changes` as `ship:review-changes` through the Skill tool in
Claude Code, `$review-changes` in Codex, or by exact ID `review-changes` with
the `skill` tool in OpenCode. If none can be invoked, read
`../review-changes/SKILL.md` relative to this file and follow it directly.

Inputs, from the user or the calling workflow:

- **Scope**, **Focus**, **Reviewers**, **Context** (all optional) — passed to
  the first review verbatim, with the focus extended as **Every review**
  describes; `review-changes` defines them and derives the scope when none is
  given.
- **Declined** (optional) — findings the caller already declined, such as
  review comments `drive-pr` answered without a change, with the reason. They
  are never fixed.
- **Rounds** (optional) — the re-review cap, a positive integer. Default 3. For
  any other value, use 3 and say so: a cap of zero would leave fixes
  unreviewed.

## Every review

Every `review-changes` run — the first and each re-review — gets, after the
caller's focus, the **Declined** findings and the findings rejected so far as
false positives, each with its location and reason. Reviewers must not report
them again.

## 1. Review

Run `review-changes` on the inputs. With no findings, report a clean review
and stop.

Before editing anything, snapshot the reviewed state so the fixes can be told
apart from the change they fix — no git command can when both sit uncommitted
in the same working tree. Record the working tree as a tree object through a
throwaway copy of the index, which leaves the real index untouched. Seeding the
copy keeps tracked files that match `.gitignore`:

```bash
idx="$(mktemp -d)/index"; src="$(git rev-parse --git-path index)"; { [ ! -e "$src" ] || cp "$src" "$idx"; } && GIT_INDEX_FILE="$idx" git add -A && GIT_INDEX_FILE="$idx" git write-tree
```

Keep the printed SHA as `<before>`. If the command fails or prints nothing,
fix the cause and rerun it; never fall back to an empty index, which drops
tracked files that match `.gitignore` and makes the later diff show them as
changes.

## 2. Verify and fix

1. **Drop what was already settled.** A finding with the same location and
   root cause as a **Declined** or rejected one is not raised again; note it
   and move on.
2. **Verify each remaining finding against the code.** `review-changes` checks
   only conflicting or cheap claims and passes the rest through. Read the cited
   lines and their callers, and confirm the finding with a concrete trigger —
   an input or state that produces the wrong result. Reject what the code
   disproves and say why; a rejected false positive is a good outcome. Keep
   every rejected finding for **Every review**.
3. **After a re-review, check whether to stop** before fixing anything — see
   **When to stop**. Findings verified at the cap are never fixed, because
   nothing would review the fix.
4. **Fix the confirmed findings**, or decline one with a stated reason — out
   of scope, a deliberate trade-off, or a fix riskier than the defect. Add each
   declined finding to **Declined**. When nothing was fixed, the loop has
   converged: stop.
5. **Rerun every quality gate the fixes could affect** — the caller's gates,
   else every non-null `qualityGates` command from `../ship/config.md`'s
   **live project facts**, read from the current worktree. Fix failures and
   rerun until green.
6. Snapshot again with the same command and keep the SHA as `<after>`.

## 3. Re-review

### Decide the scope

A fix is reviewed for what it can break, which is not always inside its own
diff. For each fix, ask what other code relies on in what it changed, and
classify it:

- **Contained** — nothing outside the edited lines observes the change: a
  renamed local or private name whose every use is in the diff, a typo, a
  comment or log message, an added test, a tightened internal condition with
  the same inputs and outputs.
- **Contract** — something outside the edited lines observes it: a function's
  signature, return value, thrown errors, side effects, or ordering; an
  exported or shared name; a data shape, schema, config key, flag, or
  environment variable; shared state or locking; in executable prose, a step,
  name, or output format other skills or commands refer to.
- **Rework** — the fix changed the change's approach instead of patching it,
  or `git diff <before> <after>` falls in the large size bucket of
  `../review-changes/reviewers.md`. Size alone never makes a Contained fix
  more than Contained: a long added test is still Contained.

A Rework fix can change contracts too, and so can another fix in the same
round. The round's scope follows the widest class among its fixes, and its
context covers every contract the round changed:

| Widest class | Scope | Context |
|---|---|---|
| Contained | `git diff <before> <after>` | none |
| Contract | `git diff <before> <after>` | every consumer of each changed contract, outside the fix diff |
| Rework | the original scope as it stands now — its commands, plus the working tree when the fixes sit uncommitted on a commit range | every consumer of each changed contract, outside the original scope |

Find the consumers — callers, implementers, tests, docs, and other skills or
commands that name the changed thing — with Grep, or LSP references where
available, and list each with the contract it relies on, such as
`src/load.ts — calls parseConfig, which now returns null on empty input`. In a
Contract round, include the parts of the original change that use the contract
too: they are outside the fix diff. Never classify a fix as Contained to keep
the scope small; when unsure, it is a Contract.

Tell the user the round, scope, and context in one line before launching — for
example
`Re-review 1/3: fix diff + context src/load.ts, src/cli.ts (parseConfig returns null on empty input)`.

### Run it

Invoke `review-changes` with:

- the scope and context decided above;
- the focus **Every review** describes, with what each fix answers and its
  class added after the caller's focus;
- as **Reviewers** to add, those whose findings were fixed, plus `review-bugs`
  whenever a fix changed code or executable prose, since a fix for any finding
  can introduce a bug. `review-changes` still adds what the new scope's signals
  call for.

Take `<after>` as the new `<before>`, and repeat from **2. Verify and fix**
with the new report.

### When to stop

Count re-reviews against the cap, **Rounds** or 3. After each re-review's
findings are verified, in this order:

1. **Converged.** No finding survived verification: stop.
2. **Repeated critical.** A verified critical finding repeats one an earlier
   round fixed — the same location and root cause. The fix did not hold: stop
   and put it to the user with what was tried.
3. **New critical.** Any other verified critical finding resets the count to
   zero, so its fix gets the full cap of re-reviews. A critical rejected as a
   false positive resets nothing.
4. **Cap.** When the count has reached the cap, or the loop has run twice the
   cap in re-reviews in total, stop without fixing: this re-review's verified
   findings stay open.

Otherwise fix them and re-review.

**Open findings block.** A critical or important finding still open when the
loop stops — neither fixed nor declined with a reason — blocks the caller's
next commit, push, or publish. Put it to the user with what was tried. Open
minor findings do not block; list them in the report.

## 4. Report

```
Review-fix loop: <converged | cap reached | stopped for the user> after <n> re-reviews
Initial review: <scope> (<size>) — <reviewers>

Re-reviews:
1. <class> — <scope> + context <files> — <n> findings
…

Fixed:
- <finding> — path/to/file.ts:123 — <what changed>

Declined:
- <finding> — <reason>

Rejected as false positives:
- <finding> — <what the code shows>

Open:
- <severity> <finding> — <what was tried, or "found at the cap">

Gates: <each command and its result>
```

Omit empty sections. End by saying the fixes are uncommitted in the working
tree for the caller or the user to commit.
