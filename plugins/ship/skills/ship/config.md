# Ship config

The ship workflow caches project facts that are stable across runs: host,
applicable project instructions, GitHub remote and default branch, quality-gate
commands, task-list presence, the exact names of installed helper skills, and
the optional Codex review command. Both first-run detection and an explicit
config refresh follow this file.

## Host and location

Identify the host from the current runtime, not from files on disk or installed
skills:

- Claude Code: `.claude/ship.local.json`
- Codex: `.codex/ship.local.json`

Read and write only the current host's cache. Never consult, copy, migrate, or
delete the other host's cache. Create the selected parent directory when needed.

Schema version 3 is the only recognized version. If the selected cache is absent,
invalid JSON, or has any other `version` (including versions 1 and 2), ignore all
cached values and run the complete detection procedure. That is also the whole
migration story: fresh detection followed by a version-3 write, never
field-by-field conversion.

## Schema

```json
{
  "version": 3,
  "detectedAt": "2026-07-22T10:30:00Z",
  "host": "codex",
  "instructions": {
    "file": "AGENTS.md"
  },
  "environment": {
    "hasGitHubRemote": true,
    "defaultBranch": "main"
  },
  "qualityGates": {
    "typecheck": "npm run typecheck",
    "test": "npm run test:run",
    "build": "npm run build",
    "lint": "npm run lint"
  },
  "tasks": {
    "tasksFile": "docs/TASKS.md"
  },
  "skills": {
    "localReview": "acme:review-current-diff",
    "documentation": null,
    "taskCompletion": "tasks:task-tracking",
    "publishing": "github:yeet",
    "ciRepair": "github:gh-fix-ci",
    "reviewFeedback": "github:gh-address-comments"
  },
  "review": {
    "codexCommand": null
  }
}
```

A Claude Code cache with both reviewers configured looks like:

```json
  "skills": {
    "localReview": "pr-review-toolkit:review-pr",
    "documentation": "claude-md-management:revise-claude-md"
  },
  "review": {
    "codexCommand": "node \"/Users/me/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/codex-companion.mjs\" review --wait"
  }
```

Field rules:

- `version`: always `3`.
- `detectedAt`: ISO-8601 UTC timestamp for the completed detection.
- `host`: exactly `claude` or `codex`; it must match the selected cache path.
- `instructions.file`: repository-relative path to the applicable existing
  instruction file, or `null`. Never create an instruction file during detection.
- `environment.hasGitHubRemote`: true only when a configured remote points to
  GitHub.
- `environment.defaultBranch`: detected default branch name.
- `qualityGates`: exact commands for `typecheck`, `test`, `build`, and `lint`, or
  `null` when the project has no corresponding gate.
- `tasks.tasksFile`: `docs/TASKS.md` when it exists, otherwise `null`.
- `skills`: exact installed skill names selected for each role, otherwise `null`.
  Skill dependencies are optional; a null value always has a built-in fallback.
- `review.codexCommand`: the exact shell command that runs a Codex review of the
  local change, or `null`. It runs alongside `skills.localReview`, never instead
  of it.

## Detection procedure

Gather every field fresh and write the selected host cache only after detection
finishes. Do not narrate every probe.

1. **Host and project instructions.** Record the current runtime host. For Claude
   Code, select the applicable existing `CLAUDE.md`. For Codex, select the nearest
   applicable existing `AGENTS.md` on the path from repository root to the current
   working directory. Record its repository-relative path, or `null`. Do not use
   `CLAUDE.md` as Codex instructions, do not use `AGENTS.md` as Claude Code
   instructions, and do not create either file.

2. **GitHub remote and default branch.** Check `git remote -v` and `gh repo view`.
   Set `hasGitHubRemote` when a remote URL points to GitHub. For `defaultBranch`,
   prefer `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`, then
   the remote HEAD branch, then the repository's evident local default branch.
   Use the current branch only as a last resort.

3. **Quality gates.** Read project configuration such as `package.json`, a
   `Makefile`, and the selected host instruction file. Record exact runnable
   commands, preferring single-run or CI variants (`test:run` over a watch-mode
   `test`). Account for commands that subsume other gates, but record a gate's own
   command when one exists. Use `null` when no gate exists.

4. **Task list.** Record `docs/TASKS.md` if it exists, otherwise `null`.

5. **Optional helper skills.** Inspect the live available-skills list supplied to
   this session. A helper is installed only when its exact skill name appears in
   that list; do not infer availability from plugin files, commands, caches, or
   documentation. Select each role independently:

   | Role | Claude Code preference | Codex preference |
   |---|---|---|
   | `localReview` | `pr-review-toolkit:review-pr`, then any installed skill whose description reviews the current/local diff or PR | Any installed skill whose description reviews the current/local diff or PR |
   | `documentation` | `claude-md-management:revise-claude-md`, then any installed skill whose description updates `CLAUDE.md` | `null` (use the built-in `AGENTS.md` review) |
   | `taskCompletion` | `tasks:tasks-done` | `tasks:task-tracking` |
   | `publishing` | `commit-commands:commit-push-pr` | `github:yeet` |
   | `ciRepair` | `null` | `github:gh-fix-ci` |
   | `reviewFeedback` | `null` | `github:gh-address-comments` |

   For `localReview`, accept a third-party skill only when its description
   clearly matches local code/diff review. Do not select a skill merely because
   “review” appears in its publisher or name, and do not repurpose CI-repair or
   review-comment skills as local review. If multiple role-matching review skills
   remain, prefer the one explicitly scoped to the current diff, then a local PR,
   and otherwise the first listed exact name. Use `null` when no match exists.

   `pr-review-toolkit:review-pr` reviews the local working tree — it derives its
   scope from `git status` and `git diff` and only checks for an existing PR
   opportunistically. Select it whenever it is installed; the “pr” in its name is
   never a reason to reject it or to skip it later because no pull request exists.

6. **Codex review command.** In Codex, set `review.codexCommand` to `null`; a
   second Codex review adds nothing there. In Claude Code, set it when the Codex
   plugin's review runtime is usable, so that `/codex:review` coverage runs in
   parallel with `localReview`. The slash command itself declares
   `disable-model-invocation`, so ship must call the underlying runtime instead:

   - Locate the installed plugin script, preferring the highest version
     directory: `~/.claude/plugins/cache/*/codex/*/scripts/codex-companion.mjs`,
     otherwise `~/.claude/plugins/marketplaces/*/plugins/codex/scripts/codex-companion.mjs`.
   - Confirm a `codex` CLI is on `PATH` with `command -v codex`.
   - When both hold, record `node "<absolute script path>" review --wait`.
     Otherwise record `null`. Do not run `codex-companion.mjs setup` during
     detection; it writes Codex plugin configuration.

7. **Write once.** Write valid, formatted JSON to the selected cache with version
   3 and a fresh timestamp. On an explicit refresh, compare all fields except
   `detectedAt` with the prior selected-host cache and report only changed values.
   An old or invalid schema is reported as a full re-detection, not as a partial
   diff.

## Fallback contract

Missing helpers never block shipping:

- `localReview`: critically self-review the current diff for correctness, edge
  cases, security, and project conventions. Self-review is the fallback for a
  missing skill, never a substitute for an installed one.
- `review.codexCommand`: skip the Codex pass; the remaining reviewer is enough.
- `documentation`: review and surgically update the selected existing instruction
  file only for durable, non-obvious guidance; if none exists or nothing durable
  changed, do not write one.
- `taskCompletion`: update `docs/TASKS.md` and the matching progress section
  directly — `docs/progress.md`, or `docs/progress/<epic>.md` for epic-grouped
  plans, refreshing that file's `Epic summary` when the change affects other epics.
- `publishing`: use `git` and `gh` directly.
- `ciRepair`: inspect GitHub checks and logs with `gh`, reproduce locally, fix,
  commit, and push.
- `reviewFeedback`: inspect review threads with `gh`, address warranted feedback,
  reply, and resolve threads when appropriate.
