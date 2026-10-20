# Ship config

The ship workflow caches repository facts that are stable across runs and
branches: host, GitHub remote and default branch, the exact names of installed
helper skills. Facts that can differ from
one branch to the next — quality-gate commands and task-list presence — are never
cached; **Live project facts** below re-reads them every run. Both first-run
detection and an explicit config refresh follow this file.

## Host and location

Identify the host from the current runtime, not from files on disk or installed
skills. The host picks the cache's path inside a worktree:

- Claude Code: `.claude/ship.local.json`
- Codex: `.codex/ship.local.json`
- OpenCode: `.opencode/ship.local.json`

Read and write only the current host's cache. Never consult, copy, migrate, or
delete the other host's cache. Create the selected parent directory when needed.

The cache lives in the repository's **main worktree**, so every worktree of a
repository shares one cache, and its location does not move as branches are
checked out. Resolve it live on every run:

1. In `git worktree list --porcelain`, the first entry is the main worktree. Its
   `worktree` path is the cache's root — even when that is the current worktree.
2. When that entry is marked `bare` (a bare repository has no working files),
   the root is the current worktree (`git rev-parse --show-toplevel`).

The cache path is `<root>/.claude/ship.local.json`, `<root>/.codex/ship.local.json`,
or `<root>/.opencode/ship.local.json` for the selected host. Use
that one path for reading and writing; never fall back to a cache in the current
worktree when the root is elsewhere. If the current worktree, being a different
one, holds its own copy of the host's cache — left from before caches were
shared — ignore it and tell the user it is stale and safe to delete.

Schema version 9 is the only recognized version. If the selected cache is absent,
invalid JSON, or has any other `version` (including versions 1 through 8), ignore
all cached values and run the complete detection procedure. That is also the whole
migration story: fresh detection followed by a version-9 write, never
field-by-field conversion.

## Schema

```json
{
  "version": 9,
  "detectedAt": "2026-07-22T10:30:00Z",
  "host": "codex",
  "environment": {
    "hasGitHubRemote": true,
    "defaultBranch": "main"
  },
  "skills": {
    "localReview": "acme:review-current-diff",
    "taskCompletion": "tasks:task-tracking",
    "publishing": "github:yeet",
    "ciRepair": "github:gh-fix-ci",
    "reviewFeedback": "github:gh-address-comments"
  }
}
```

A Claude Code cache looks like this. `localReview` is `null` because Claude Code
always reviews with the bundled `review-changes` skill:

```json
  "skills": {
    "localReview": null,
    "taskCompletion": "tasks:tasks-done"
  }
```

Field rules:

- `version`: always `9`.
- `detectedAt`: ISO-8601 UTC timestamp for the completed detection.
- `host`: exactly `claude`, `codex`, or `opencode`; it must match the selected cache path.
- `environment.hasGitHubRemote`: true only when a configured remote points to
  GitHub.
- `environment.defaultBranch`: detected default branch name.
- `skills`: exact installed skill names selected for each role, otherwise `null`.
  Skill dependencies are optional; a null value always has a built-in fallback.
- `skills.localReview`: always `null` in Claude Code — local review is the
  plugin's own `review-changes` skill and its reviewer agents, which need no
  detection. In Codex it holds an installed local-diff review skill, or `null`;
  `review-changes` uses it there until the skill supports Codex directly.

In OpenCode, `skills.localReview` is also `null`: load the bundled
`review-changes` skill by its exact ID. For task completion prefer the installed
`task-tracking` skill. Discover publishing, CI repair, and review-feedback helpers
by their descriptions in the live skills list, otherwise use `null` and the
built-in fallbacks. Never select `ship`, `rebase`, `drive-pr`,
`review-fix-loop`, or `review-changes` as optional helpers: that would recurse
into these workflows.
Do not assume Claude namespaced IDs exist in OpenCode.

## Live project facts

Read these from the **current** worktree on every run, before the first step
that needs them, and never write them to the cache: they describe the branch
being shipped, and another worktree's branch can differ. The workflows refer to
them by these names.

- **`qualityGates`** — exact commands for `typecheck`, `test`, `build`, and
  `lint`, or `null` when the project has no corresponding gate. Read project
  configuration such as `package.json`, a `Makefile`, and the host's applicable
   instruction file (`CLAUDE.md` in Claude Code, applicable `AGENTS.md` files in
   Codex or OpenCode). Record exact runnable commands, preferring single-run or CI variants
  (`test:run` over a watch-mode `test`). Account for commands that subsume other
  gates, but record a gate's own command when one exists.
- **`tasks.tasksFile`** — `docs/TASKS.md` when it exists in the current
  worktree, otherwise `null`.

## Detection procedure

Gather every field fresh and write the selected host cache only after detection
finishes. Do not narrate every probe.

1. **Host.** Record the current runtime host.

2. **GitHub remote and default branch.** Check `git remote -v` and `gh repo view`.
   Set `hasGitHubRemote` when a remote URL points to GitHub. For `defaultBranch`,
   prefer `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`, then
   the remote HEAD branch, then the repository's evident local default branch.
   Use the current branch only as a last resort.

3. **Optional helper skills.** Inspect the live available-skills list supplied to
   this session. A helper is installed only when its exact skill name appears in
   that list; do not infer availability from plugin files, commands, caches, or
   documentation.

   Select each role independently:

   | Role | Claude Code preference | Codex preference |
   |---|---|---|
   | `localReview` | `null` — use the bundled `review-changes` skill | Any installed skill whose description reviews the current/local diff or PR |
   | `taskCompletion` | `tasks:tasks-done` | `tasks:task-tracking` |
   | `publishing` | `commit-commands:commit-push-pr` | `github:yeet` |
   | `ciRepair` | `null` | `github:gh-fix-ci` |
   | `reviewFeedback` | `null` | `github:gh-address-comments` |

   For OpenCode use the choices described under **Field rules** above instead
   of either column. Only record IDs present in this session's live skill list.

   Local review needs no detection in Claude Code. This plugin bundles its own
   orchestrator, the `review-changes` skill, which picks among the plugin's
   read-only `ship:review-*` agents and their models for each change. It is
   installed with ship itself, so it cannot go missing. Record `null`.

   Do not record Claude Code's built-in `code-review` — it is
   `disable-model-invocation`, user-invocable only, so ship cannot call it, and
   recording it is exactly the stale-cache bug that the schema 5 bump cleared.
   `/code-review ultra` is a billed cloud review only the user may trigger.
   `code-review:code-review` is a different thing again: a marketplace plugin
   that reviews an *open GitHub pull request* and posts a comment on it, which is
   the wrong scope and an outward action ship never takes during local review.

   In Codex, `review-changes` cannot launch its reviewer agents yet, so detect a
   review skill for it to delegate to. Never record this plugin's own
   `review-changes` or `review-fix-loop` — they match the description best, and
   recording either makes `review-changes` recurse into itself. Accept a skill
   only when its description clearly matches local code/diff review. Do not select
   one merely because “review” appears in its publisher or name, and do not
   repurpose CI-repair or review-comment skills as local review. If several
   role-matching skills remain, prefer the one explicitly scoped to the current
   diff, then a local PR, and otherwise the first listed exact name. Use `null`
   when no match exists.

   `pr-review-toolkit:review-pr` qualifies there. It reviews the local working
   tree — it derives its scope from `git status` and `git diff` and only checks
   for an existing PR opportunistically — so the “pr” in its name is never a
   reason to reject it or to skip it later because no pull request exists.

4. **Write once.** Write valid, formatted JSON to the selected cache — at the
   root resolved under **Host and location** — with version 9 and a fresh
   timestamp. On an explicit refresh, compare all fields except
   `detectedAt` with the prior selected-host cache and report only changed values.
   An old or invalid schema is reported as a full re-detection, not as a partial
   diff.

## Fallback contract

Missing helpers never block shipping:

- `localReview`: in Claude Code and OpenCode the bundled `review-changes` skill is the
  route, and it ships with the plugin, so there is nothing to fall back from. In
  Codex, when no review skill is recorded, `review-changes` reviews the scope
  itself against its reviewers' checklists. Self-review is the fallback for a
  missing reviewer, never a substitute for an available one.
- `taskCompletion`: for a plan whose task files carry frontmatter, skip and point
  the user at `/tasks:tasks-done`; for an older checkbox plan, update `docs/TASKS.md` and the matching progress section
  directly — `docs/progress.md`, or `docs/progress/<epic>.md` for epic-grouped
  plans, refreshing that file's `Epic summary` when the change affects other epics.
  Choose by inspecting the layout, and skip completion entirely if it is neither
  coherently flat nor coherently epic.
- `publishing`: use `git` and `gh` directly.
- `ciRepair`: inspect GitHub checks and logs with `gh`, reproduce locally, and
  fix; then review, commit, and push the fix as the `drive-pr` skill's **Review
  every fix before it is pushed** describes.
- `reviewFeedback`: inspect review threads with `gh` and address warranted
  feedback, as the `drive-pr` skill's **Address review feedback** describes —
  including replying to and resolving every handled thread.
