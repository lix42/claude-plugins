# session-compass

A Claude Code mod for working in several sessions at once. A pane beside the
chat says which session this is and what has happened in it, so a window you
come back to after a while tells you where you are.

This is not a skill: it is a hooks module, and it draws only in Claude Code.

## What the pane shows

- **The session's name**, in the session's accent color: the name
  given with `/rename`, else the title Claude Code generated for the session.
  It is also the pane's tab label when other panes are open.
- **Where it runs**: the repository (or folder) and the branch.
- **The history**, oldest first, as the transcript reads, with the newest entry
  at the bottom. Whenever what the pane shows changes, it scrolls to its end,
  unless you scrolled up to read older ones; scroll back to the end and it
  follows again. Opening a prompt's rewind choice does not move it.
  The name and place sit under the newest entry.
  - each prompt, marked with the accent color; a slash command is highlighted
    as `/name args`.
  - each response with what it used: skills as `◆ name`, subagents as
    `◇ type`, and the other tools counted (`Bash×3 Edit×2`), then how long it
    took.
  - any prompt or response longer than two lines is summarized into one sentence
    by `haiku` (shown in italics). The response still running is not; it is
    summarized when its turn ends. Each text is summarized once: summaries are
    kept by the text's hash in the mod's store, across reloads, rebuilds and
    new processes.

## Opening it

The pane opens by itself after the session's first prompt, when the terminal
draws the fullscreen layout (where it docks beside the transcript). On the main
screen it would sit above the prompt instead, so it waits for `/compass` there.
Closing the pane keeps it closed for the session.

## Going back to a prompt

Press a prompt in the pane (click, or ctrl+x tab to focus the pane, then Tab and
Enter) to see two choices:

- **Rewind…** opens Claude Code's own `/rewind` picker. A mod cannot pick the
  message for it, so choose the prompt there.
- **Copy to prompt** puts the prompt back in the prompt box, to send again or
  edit.

After a rewind the history is rebuilt from the transcript before the next
prompt, if the rewind cut it; a cancelled one changes nothing. A rewind through
the keyboard (Esc Esc) is not seen by the mod; run `/compass resync` after one.

A rebuilt entry shows no time: the transcript's message list carries none.

## Renaming it and changing its color

Press the session's name at the bottom of the pane to open an editor under it:

- **Name**: type a name and press Enter. It runs Claude Code's own `/rename`, so
  the session list and a resume show the name too.
- **Accent color**: press a swatch (the current one is `◉`), or type a hex color
  in the **Hex** field. From the keyboard: ctrl+x tab focuses the pane, then
  `1`–`9`, `0`, `a` pick the swatches in order, or Tab onto one and press
  Enter. While a text field has the focus, keys type into it; Esc or Tab leaves
  it.
- **Done** closes the editor; pressing the name again does too.

On the mobile surface, which draws no text field, the editor shows the swatches
alone.

## Accent colors

Each session gets the next color of an eight-color palette, so sessions opened
one after another differ. The color is kept per session id, so a resumed
session keeps its color, and `/clear` keeps it too (same window, new
conversation). `/resume` into another session within the same window switches
to that session's history, name and color.

Two sessions started in the same instant may get the same color (the store
has no atomic counter); `/compass color next` sets one apart.

## Commands

| Command | Description |
|---------|-------------|
| `/compass` | Open the pane |
| `/compass color <name\|#hex>` | Set this session's accent: `blue`, `green`, `amber`, `orange`, `pink`, `violet`, `cyan`, `red`, `lime`, `yellow`, `teal`, or a hex color |
| `/compass color next` | Move to the palette color after this session's |
| `/compass resync` | Rebuild the history from the transcript |

## How it knows

- Prompts, tool calls and turns come from the `prompt.submit`, `tool.call`,
  `turn.start` and `turn.complete` events of the main loop; subagents' own tool
  calls are not counted.
- On a resumed session (or after a restart), the history is rebuilt from
  `$.session.messages()`. That list does not mark the rows Claude Code adds
  itself (skill bodies, command output, notices, a compaction's summary), so
  they are left out by their known prefixes, and the row right after a command
  is taken as the command's own expansion; an unknown kind may show as a prompt
  until the next live one.
- The repository and branch are read at the start and again after each turn,
  so a branch switch shows once the turn that made it ends.
- The session name is read from the session's transcript file
  (`~/.claude/projects/*/<session id>.jsonl`, or under `CLAUDE_CONFIG_DIR`). The
  mod API has no call for it, and the file's format is Claude Code's own, so a
  future release may move it; the heading then says "Unnamed session".
- Summaries cost one small `haiku` call per long text, through the session's own
  credentials. At most 40 are asked for per pass, newest first: one pass at the
  session's start and one after each turn, so a long resumed session catches
  up over a few turns.

## Development

```sh
claude plugin validate plugins/session-compass
claude plugin test plugins/session-compass
claude --plugin-dir plugins/session-compass   # a session that hot-reloads it
```

`tsc -p plugins/session-compass` type-checks it once Claude Code has loaded the
mod and written `.claude-plugin/types/`.
