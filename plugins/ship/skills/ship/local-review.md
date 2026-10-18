# Local review

How the ship workflow reviews a local change. `ship` runs it once before the
first commit; `drive-pr` runs it on every fix before pushing it to a pull
request; `rebase` runs it on every conflict resolution and adaptation. The
caller states the scope.

A missing pull request is never a reason to skip a configured reviewer.

Run every applicable reviewer, in parallel when more than one applies. Start both
before collecting either: launch `review.codexCommand` as a background Bash job,
start the local reviewer, then collect both results.

- **Local review.** In Claude Code, launch this plugin's bundled
  `ship:diff-reviewer` agent with the Task tool. It ships with ship, so it needs
  no detection and is always available. In Codex, invoke the exact
  `skills.localReview` skill instead when one is recorded.
- **Scope.** Tell the reviewer what to review: the working tree while the change
  is uncommitted, or the diff against a base once it is committed. Never
  downgrade a reviewer to a self-review because no pull request exists.
- **Never route local review through `/code-review`.** Claude Code's built-in
  review command is `disable-model-invocation` — user-invocable only — so the
  workflow cannot call it, and `/code-review ultra` is a billed cloud review
  reserved for the user. `code-review:code-review` is also wrong: that
  marketplace plugin reviews an open GitHub pull request and comments on it.
- **`review.codexCommand`.** When set, run it verbatim with Bash for an
  independent Codex review of the same local change. This is the programmatic
  form of `/codex:review`, which is likewise user-invocable only. Append
  `--base <base>` when the scope is committed rather than sitting in the working
  tree. Treat a Codex failure — missing CLI, auth error, non-zero exit — as a
  skipped reviewer: report it and continue with the rest of the review.

Critically self-review the whole scope for correctness, edge cases, security,
error handling, and project conventions only when no reviewer is available at
all — in Codex with no review skill installed, and no Codex command.

Investigate every finding from every reviewer, deduplicating overlap. Fix
warranted issues and state why any finding is declined. Rerun affected quality
gates after changes.
