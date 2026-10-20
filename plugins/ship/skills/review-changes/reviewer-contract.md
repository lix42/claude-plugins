# Reviewer contract

Every reviewer agent launched by `review-changes` follows this contract. The
agent's own file defines only its focus: what to look for and what is out of
scope. Scope handling, verification, the reporting bar, and the output format
live here, so the orchestrator can merge every reviewer's report mechanically.

## Rules

- **Read-only.** Never edit files, stage, commit, push, or post anything to
  GitHub. You report; the caller decides what to fix.
- **Stay in your lane.** Report only findings within your focus. Another
  reviewer covers the rest; a finding outside your focus is noise the
  orchestrator has to deduplicate.
- **Review the given scope.** The orchestrator states the scope and the exact
  git commands that produce it. Use them verbatim. Never widen to unrelated
  files or history. If the scope is empty or cannot be resolved (missing base,
  not a git repository), say so and stop.
- **Judge the context against the scope.** The brief may list context files:
  unchanged code that relies on something the scope changed, each with the
  reason. Read each one and report what the scoped change breaks there — a
  caller the new contract no longer fits, a test that no longer holds. Never
  report a context file's pre-existing problems; it is not part of the change.

## Process

1. **Read the change with context.** Run the scope's diff with `-U15`, or read
   the changed files directly. A hunk read without its surroundings produces
   false positives. Read every untracked file the brief lists in full — they
   are new files in the scope that no `git diff` shows.
2. **Load project conventions.** Read the applicable `CLAUDE.md` / `AGENTS.md`
   files the orchestrator names, and nearby code in the changed files. Project
   rules and local idiom outrank general preference.
3. **Verify before reporting.** For each suspected issue, open the surrounding
   code and confirm it is real: whether a caller already guards the case,
   whether the value can actually be null, whether the branch is reachable,
   whether the issue predates this change.

## Reporting bar

Rate each candidate 0–100 on how confident you are that it is a real problem
introduced or exposed by this change:

- **100** — verified; you can name the input or state that triggers it.
- **80** — very likely real and it matters; you checked the surrounding code.
- **50** — plausible, but may be a nitpick or already handled elsewhere.
- **≤25** — speculative, uncodified preference, or pre-existing and untouched.

**Report only findings at 80 or above.** An empty list is a valid, useful
result. Never pad the report to look thorough.

Give each reported finding a severity:

- **critical** — breaks behavior, loses data, or opens a security hole.
- **important** — a real defect or gap that should be fixed before merging.
- **minor** — real and worth fixing, but low risk if it waits.

## Output format

Return exactly this shape — no preamble, no offer to fix:

```
Reviewer: <your agent name>
Scope: <what you reviewed, e.g. "working tree, 6 files">

## Findings

### 1. <one-line summary> — <severity>, <confidence>
- **Where:** path/to/file.ts:123
- **Problem:** what is wrong and the concrete input or state that triggers it
- **Fix:** the smallest change that resolves it

## Notes
<optional: at most three short observations below the bar — omit the section
when there are none>

## Not reviewed
<optional: files in scope you skipped (generated, vendored, too large) and why —
omit the section when there are none>
```

Order findings most severe first. With nothing at or above the bar, write
`## Findings` followed by `None at or above the reporting bar.`
