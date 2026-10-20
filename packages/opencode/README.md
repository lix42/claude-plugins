# OpenCode integration

One OpenCode V2 package for **tasks**, **ship**, and **pr-panel**, installed from
this Git repository. The root `package.json` includes the shared skill directories,
task CLI, reviewer/scout instructions, and PR-panel core. Nothing is fetched from
the development checkout at runtime, generated, or copied into user config.

## Install

Requires OpenCode **2.0.32+**. The task CLI requires Node **22.18+**. PR operations
use the server's authenticated `gh` executable; credentials are never copied into
plugin options or sent to the terminal.

```sh
opencode plugin add github:lix42/claude-plugins#main
opencode plugin list
```

The installed package exports both a server plugin and a `./tui` plugin. Local
OpenCode loads the terminal entrypoint automatically. No skills.sh account,
development-folder symlink, or per-command setup is required.

```sh
opencode plugin check
opencode plugin update
opencode plugin remove github:lix42/claude-plugins#main
```

For a fixed revision, install `github:lix42/claude-plugins#<complete-commit-hash>`
instead of `#main`. Pinned revisions are not automatically updated. These GitHub
instructions require the integration files to have landed on the chosen revision.

## Commands and skills

| Commands | Skill |
| --- | --- |
| `/tasks-setup`, `/tasks-next`, `/tasks-update`, `/tasks-done`, `/tasks-group`, `/tasks-migrate` | `task-tracking` |
| `/start-task <task>` | `start-task` (explicit invocation only) |
| `/ship`, `/ship-config` | `ship` |
| `/drive-pr [number\|url]` | `drive-pr` |
| `/rebase [base]` | `rebase` |
| `/review-changes [scope]` | `review-changes` |
| `/pr [url\|number\|untrack\|agent on\|agent off]` | Native terminal command, not an agent skill |

Commands attach the registered skill and preserve arguments and file attachments.
Natural-language requests and explicit `@ship` / `@task-tracking` also work.
`start-task` uses OpenCode's session-movement tool when available; otherwise it
reports that limitation and targets the worktree through explicit paths.

Ship uses `.opencode/ship.local.json` in the main worktree. It never reads or
rewrites Claude/Codex caches. Schema 9 triggers fresh detection of older caches.
Like the Claude workflow, it never ships past red gates or merges a GitHub PR.

## Options

After installation, use the object form for the existing plugin entry in
`~/.config/opencode/opencode.jsonc`; do not add a second copy:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "github:lix42/claude-plugins#main",
      "options": {
        "tasks": true,
        "ship": true,
        "prPanel": true
      }
    }
  ]
}
```

All three features default to `true`; disabling one removes its definitions.
Tasks and ship remain usable without PR-panel. Ship can operate without the task
helper, using the shared workflow's fallback rather than hand-editing an index.

### Reviewer models

The agents `ship/review-bugs`, `ship/review-security`, `ship/review-error-handling`,
`ship/review-tests`, `ship/review-conventions`, `ship/review-types`,
`ship/review-docs`, and `ship/rebase-scout` inherit the parent model by default.
No Claude provider or model alias is assumed.

Set `options.models` to a map of short agent names to installed
`provider/model[#variant]` references. A `default` entry applies to every bundled
agent; a named entry overrides it. For example:

```json
"models": {
  "review-bugs": "openai/gpt-5#high"
}
```

Use a model ID actually available in your workspace. The model example is not an
additional provider installation. Reviewers deny shell execution and editing;
the orchestrator supplies the diff or a temporary diff-file path and they inspect
code with read/glob/grep. The rebase scout may edit as its workflow requires.
The reviewer contract is embedded in each reviewer's system instructions, so
loading that contract needs no external-directory approval. Supply diffs inline
or in the project; genuinely external project files still follow user permissions.

## PR-panel behavior

The summary appears above the composer. `/pr` opens the session panel; PR numbers
and mouse actions switch the selected PR. The panel shows checks, latest reviews,
unresolved threads, recent comments, errors, and available GitHub actions.

While the panel owns keyboard input:

| Key | Action |
| --- | --- |
| `r` / `u` | Refresh / untrack |
| `1`–`9` | Select a PR |
| `s` | Select an allowed merge method |
| `a` | Enable/disable auto-merge |
| `m` / `b` | Merge / bypass protections and merge |
| `d` / `x` | Mark draft ready / rerun failed Actions runs |
| `f` | Choose a failed check or review thread to fix |
| `v` | Toggle fullscreen when the terminal is wide enough |

Every mutation requires confirmation. The server then re-fetches the PR and
checks that the action is still available and its head has not changed. Merge
commands additionally pass `--match-head-commit`. Confirmation tokens are
single-use and expire after a minute. Preparing a confirmation in another client
does not invalidate existing tokens. Confirmations wait for polling to finish;
a busy session does not consume a token before the action can be attempted.
Mutations also go through the owning session's OpenCode shell-permission rules;
the native UI is not a way around a denied `gh pr merge` or rerun command.

**Fix** never sends a message by itself: it fetches the relevant context, opens an
editable preview, and requires a separate **Send** confirmation. Cancelling leaves
the session untouched. This intentionally differs from Claude's composer filling,
which the current public OpenCode terminal API does not expose.
Fix targets retain the displayed PR URL and thread/check identity rather than a
list position or the shared selection. Resolved/removed threads and stale,
ambiguous, or no-longer-failing checks are rejected; checks also retain their
displayed commit SHA. Reopen the chooser after refreshing when a target is stale.

Opening `/pr` with no tracked PRs retries branch discovery, including after a
temporary authentication failure or untracking the last PR. Concurrent discovery
requests share one attempt.

Tracking, polling, and durable snapshots belong to the server, independently of
the number of terminal clients. State is scoped to the plugin location and root
session. Subagent prompts never create pollers or receive PR-activity wakeups;
PR-creation observations in a child session are routed to its root session.
Session movement/deletion and plugin unloading abort outstanding processes and
stop their polling. Temporary session lookup failures do not abort running
commands. Empty backends are evicted after a minute without activity, preserving
their settings for a later reopen; tracked root-session PRs continue monitoring.
Small state edits are batched into one persistence write and snapshot event,
rather than forcing every terminal to refetch the full state for each edit.
Existing shared polling intervals, conditional GitHub requests,
agent-message batching, and untrusted-comment quoting are retained.

PR activity messages are enabled by default, as in the Claude mod. Use `/pr agent
off` to disable them for that session; `/pr agent on` restores them. Messages are
queued rather than interrupting active work. Closing a panel does not disable
server polling or the agent toggle.

### Remote servers

Install/configure the server package on the machine hosting OpenCode. `gh` and Node
run there, against the session's directory. If the terminal does not automatically
load the remote server's terminal entrypoint, also add the same Git package to
the terminal machine's `~/.config/opencode/cli.json`:

```json
{ "plugins": ["github:lix42/claude-plugins#main"] }
```

This is package-level setup, not per-command configuration. The TUI communicates
through OpenCode's authenticated plugin RPC; it does not execute `gh` locally.
The TUI checks the server's PR-panel capability, so `prPanel: false` on the server
quietly disables its controls even if the terminal uses default options. Background
connection retries do not produce periodic error toasts. Important PR notices can
notify the terminal even when the relevant session is not mounted.
Only the terminal UI is currently provided—there is no custom web/desktop panel.

## Development and verification

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
node --test 'plugins/tasks/skills/task-tracking/cli/test/*.test.ts'
claude plugin test plugins/pr-panel
python3 packages/opencode/scripts/smoke.py
python3 packages/opencode/scripts/smoke.py --disable-panel
python3 -m unittest discover -s packages/opencode/scripts -p '*_test.py'
npm pack --dry-run
```

The OpenTUI tests require Bun; the Node requirement above is for the task CLI.
The smoke script creates a private server with isolated HOME/config/data and an
in-memory database, checks registration and RPC without starting a model, and
terminates that server. It leaves its temporary diagnostics directory in place.
Startup announcements and shutdown are time-bounded; a server that ignores
SIGTERM is killed with a second bounded wait rather than hanging the smoke job.
Pass a packed/extracted package directory to test installation without a source
checkout. Set `OPENCODE_TEST_TMP` to choose the diagnostic parent directory.
Use `--git <git-package-target>` to exercise `opencode plugin add` itself inside
the isolated configuration before running the same assertions.

The package runs source TypeScript under OpenCode's loader and needs no build or
installation lifecycle scripts. The two root forwarding entrypoints also support
directory-based development loading. Shared files remain in `plugins/`; adapters
and tests live here. Do not duplicate workflows into host-specific skill copies.
