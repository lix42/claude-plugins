# pr-panel

A Claude Code mod that keeps the GitHub PRs of the session in view: a live pane
with checks, reviews, unresolved review threads and comments, a one-line summary
above the prompt, and buttons to enable auto-merge, merge, re-run failed checks,
or hand a failure back to Claude.

This directory contains the Claude Code adapter and shared core. The
[OpenCode integration](../../packages/opencode/README.md) reuses the same polling,
parsing, actions, and prompt logic with its own server and terminal adapters.
This is not a skill. Requires an authenticated
[`gh`](https://cli.github.com/) on the `PATH`; every GitHub call goes through it,
so GitHub Enterprise works wherever `gh` is logged in.

## What it tracks

- **PRs the session creates**: any Bash call running `gh pr create` (so `/ship`
  and `commit-push-pr` too) is tracked from the URL it prints.
- **The current branch's PR** at session start, when one is open.
- **Any PR you name**: `/pr <url>` or `/pr <number>` (a number resolves against
  the repo of the PR shown, or the current branch's).

Every tracked PR has a tab in the pane. `/pr` opens the pane; `/pr untrack`
stops tracking the PR shown.

## Telling the agent

When a poll finds something the agent may need to handle, the mod sends it a
message (`$.prompt.submit`), a turn of its own once the session is idle. It says
what happened, not what to do: the agent decides, and a `/ship` `drive-pr` loop
handles it as its own process says. Activity found within one tick goes out as
one message. It reports:

- CI finishing with failed checks (names and links; the agent fetches the logs).
- The PR starting to conflict with its base.
- A review requesting changes, or a review comment with a body.
- New unresolved review threads and new replies on them.
- New top-level comments from people (bots' are left out).

Comments by the `gh` account are left out: the agent replies as it, so its own
replies would come back to it. Until the review-threads query has succeeded
once, the mod does not know that account, so only CI and conflicts are sent.
A conflict is reported once, not again each time GitHub recomputes it after a
push. A send that fails is retried at the next poll. Passing checks, approvals,
auto-merge and merges are not sent (the toast and desktop notification cover
them). Quoted GitHub text is capped and marked as information, not instructions,
since anyone who can comment on the PR writes it.

On by default; `/pr agent off` stops it for the session, `/pr agent on` starts
it again, `/pr agent` says which.

## The pane

- Header: title, link, state, branch, merge state, review decision, auto-merge.
- Checks: counts, with failed and pending checks listed. **Fix** on a failed
  check fetches the tail of its Actions log (`gh run view --log-failed`) and
  puts a prompt in your prompt box. You edit it and press Enter yourself.
- Reviews: the latest review per reviewer.
- Unresolved threads: file:line and the first comment. **Fix** puts a prompt
  quoting the comment in your prompt box.
- Comments: the latest people's comments; bot comments are only counted.
- Actions, shown when they apply:
  - **Merge method**: only the methods the repo allows (squash, then merge
    commit, then rebase by default).
  - **Enable / Disable auto-merge** (when GitHub lets you enable it on this PR).
  - **Squash and merge** (or the chosen method), only while GitHub would merge
    it. A blocked PR shows a `Merge blocked: …` line with the reasons it can see
    (unresolved threads, required review, failing or pending checks) instead.
  - **Bypass rules and merge** (`gh pr merge --admin`), on a blocked PR when
    GitHub says you can merge as an admin.
  - Merge and bypass ask for a second press (Confirm / Cancel) in the pane.
  - **Ready for review** on a draft.
  - **Re-run failed** for failed Actions runs.

### Keys

`ctrl+x tab` moves the keyboard into the pane (Tab, the arrows and Enter walk and
press its buttons, Esc goes back to the prompt, `ctrl+x x` closes it). While the
pane has the keyboard, single keys press buttons:

| Key | Button |
| --- | --- |
| `r` / `u` | Refresh / Untrack |
| `1`–`9` | Switch PR tab (shown with more than one PR) |
| `a` | Enable or disable auto-merge |
| `m` | Merge (asks to confirm) |
| `b` | Bypass rules and merge (asks to confirm) |
| `y` / `n` | Confirm / Cancel |
| `d` | Ready for review |
| `x` | Re-run failed |
| `f` | Fix the first failed check |

A thread row expands on press to show the whole conversation, and collapses on
the next.

On narrow terminals (under 144 columns) a pane opened unasked waits; the band
above the prompt shows a summary line per PR either way, for example
`#42 · ✓5 ✗1 …2 · 2 unresolved · auto-merge: squash`.

## How it stays fresh

GitHub cannot push to a local session, so the mod polls, cheaply:

1. Each poll sends conditional requests (`If-None-Match`) for the PR, its head
   commit's check runs and its commit status. A `304 Not Modified` does not count
   against the rate limit.
2. Only when one of them changed does it fetch the PR in full (`gh pr view` plus
   one GraphQL query for review threads and repo merge settings). A full fetch
   also runs at least every five minutes, since thread resolutions do not move
   the probes.
3. Polls run every 15 s while checks are pending, auto-merge is on or the merge
   state is still computing; every 60 s otherwise; never again once the PR is
   merged or closed. A `git push`, `gh pr …` or `gh run rerun` in Bash, or a
   button, polls at once.

An action that fails says why in the pane (gh's error) until the next action or
**Dismiss**, and in a toast. One that succeeds says so for 10 s (enabling
auto-merge reads "Auto-merge enabled"), and in a toast. Changes raise a toast. Finished checks, new reviews and a merge or close also
raise a desktop notification.

A merged PR's title turns green in the pane and the band; a closed one is dimmed
in the band. Either stops polling, shows its final state for two minutes, then
leaves the band and the pane; the pane closes once no PR is left.

## Layout

| File | Role |
| --- | --- |
| `hooks/register.tsx` | Wires events, holds the state atoms, and builds the `Io` adapter from `$`; the only file that touches `$` |
| `hooks/io.ts` | The `Io` type: what the rest needs from the engine |
| `hooks/sync.ts` | Tracking, probing, fetching, announcing changes, and the agent outbox |
| `hooks/actions.ts` | Button actions and Fix prompts |
| `hooks/gh.ts` | `gh` argv builders and the runner |
| `hooks/parse.ts` | Pure: PR URLs, `gh` JSON into snapshots, HTTP replies |
| `hooks/derive.ts` | Pure: summaries, poll intervals, available actions, change detection, agent events |
| `hooks/prompts.ts` | Pure: Fix prompt and agent message text |
| `hooks/view.tsx` | Pure drawing of the band and the pane |

## Developing

```sh
claude --plugin-dir plugins/pr-panel      # load it, hot-reloading on save
claude plugin validate plugins/pr-panel
claude plugin test plugins/pr-panel
```

Once loaded, Claude Code writes the API types to `.claude-plugin/types/`
(git-ignored), and `tsc -p plugins/pr-panel` type-checks the mod.

`tsconfig.json` includes the API and built-in tool types but not
`claude-code-mcp`, which declares every MCP tool connected on the machine that
last loaded the mod. The mod calls no MCP tool, and with about 300 of them the
`tool.call` matcher type exceeds TypeScript's instantiation depth (TS2589), so
whether the check passed would depend on the machine.
