---
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
description: Re-check the ship workflow's environment (remote, quality gates, task list, available skills) and update the cached config, reporting what changed
user-invocable: true
args: none
---

# /ship-config — Re-check and update the ship config

The ship workflow caches its Claude Code environment as schema version 3 in
`.claude/ship.local.json` so it doesn't re-detect stable facts every run. Run this
command to refresh that cache after your environment changes — a remote was
added, the project's scripts changed, or you installed/removed a helper plugin.
Never read or modify the Codex cache at `.codex/ship.local.json`.

The cache location, schema, and detection procedure are defined in
`${CLAUDE_PLUGIN_ROOT}/skills/ship/config.md` — read it and follow it.

Do this:

1. **Read the existing config** at `.claude/ship.local.json`, if present. Keep its
   values in hand for comparison only when it is valid schema version 3 for the
   `claude` host. Missing, invalid, older-version, and unknown-version caches
   require full re-detection rather than migration or a field-by-field diff.

2. **Re-detect every field** using the detection procedure in `config.md`. Detect
   fresh; don't trust the old values.

3. **Report what changed.** Compare field by field against the old config and show
   the user a concise diff — only the fields that changed, as `old → new`. For
   example:

   ```
   Ship config changes:
   - environment.hasGitHubRemote: false → true
   - qualityGates.test: npm test → npm run test:run
   - skills.localReview: (none) → pr-review-toolkit:review-pr
   - review.codexCommand: (none) → node ".../codex-companion.mjs" review --wait
   ```

   If nothing changed, say so plainly: *"Ship config is already up to date — no
   changes."* If there was no prior config, report it as a first-time detection and
   list what was found rather than a diff.

4. **Write the updated config** to `.claude/ship.local.json` (with a fresh
   `detectedAt`), even when nothing changed, so the timestamp reflects the check.
   Don't write a half-detected file — only write once every field is gathered.

This command only inspects the environment and rewrites the config file. It does
**not** run quality gates, review, commit, or ship anything — that's `/ship`.
