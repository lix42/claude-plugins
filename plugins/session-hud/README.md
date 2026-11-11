# session-hud

A Claude Code mod that keeps the session's vital signs in a pane beside the
chat: where it runs, what it has used, what Claude is doing now, and the skills
and commands at hand, each a press away from the prompt.

This is not a skill: it is a hooks module, and it draws only in Claude Code.

## Opening it

Run `/hud`. The pane's tab reads `hud`.

## What the pane shows

### Context

- **path**: the working folder, with the home folder as `~`.
- **repo**: `owner/name` from the `origin` remote (`https`, `git@` and
  `ssh://` URLs), else the repository folder's name.
- **branch**: the checked-out branch, read again after each turn.
- **session**: the session id's first 8 characters, and how long the session
  has been up.
- **model**: the session's model, read again after `/model`.

### Usage

- **context**: how full the context window is, as a bar, a percentage and
  `used/window` tokens.
- **5h** and **7d**: each rate-limit window the last response reported, as a
  bar and a percentage, with when it resets.
- **cost**: shown only on extra usage, when a 5h or 7d window is at or past
  100%, or when a gateway reports a spend limit. Claude Code has no flag for
  extra usage, so the mod reads it from the windows. The figure is the
  session's whole cost, not only the part past the plan.

Bars turn amber at 70% and red at 90%.

### Status

- **● Working**: how long the turn has run, the tool running now with a short
  detail (a Bash command's description, a file name, a pattern or a skill), the
  prompt the turn began with, and how many tools it called and subagents run.
- **◐ Waiting for you**: a tool call asks for approval, or Claude asked a
  question or for a plan's approval. In auto mode the classifier may settle an
  approval itself, so this can show briefly when nobody is asked.
- **○ Idle**: for how long, and how long the last turn ran, and how it ended if
  it did not answer (interrupted, error).

The times tick every second while a turn runs and every 15 seconds idle, only
while the pane shows.

#### Other sessions of this conversation

Under the status, the pane lists this conversation's forks that run now as
background sessions of their own (`/fork` starts one), oldest first, whoever
started them. Each shows:

- its name and state: `● working` (for how long its turn has run),
  `◐ waiting for you`, `○ idle` or `✓ done` (how long ago it last did
  anything), and its short id;
- while it works, the tool it runs now, with a short detail;
- its latest prompt.

The running sessions come from `claude agents --json`; a fork is one whose
transcript starts with the same message as this session's, as a fork's starts
with the copy of its parent's (so a fork of a fork, or of this session's
parent, is listed too). What each does is read from the end of its transcript.
They are read when `/hud` opens the pane, shortly after `/fork`, every 10
seconds while the pane shows, and when you press **↻** beside **Status**. The
rows are for reading: a fork runs in a process of its own, which this window
cannot switch to; `claude attach <id>` opens it in a terminal.

#### Coming back to a session

The pane opened with `/hud` opens again when you come back to the session, from
the agent list or after a restart, until you close it yourself: the mod keeps,
in its store, which sessions' panes are open.

### Skills & commands

Every slash command the session has, in groups:

- **Pinned**: the commands you pinned, in the order pinned. It shows once
  something is pinned.
- **Project**: the project's own skills and commands, from `.claude/skills/`
  and `.claude/commands/` in the working folder or the project's root.
- **User**: your own, from `~/.claude/skills/` and `~/.claude/commands/`
  (`$CLAUDE_CONFIG_DIR` when set). Claude Code reports project and user
  commands alike, so a command found in neither folder counts as the user's.
- **Plugins**: one sub-group a plugin, sorted by name.
- **MCP** and **Built-in**.

In each row:

- **The name** (`/deploy`) puts the command in the prompt box. What the box
  already holds stays after it as the command's arguments; a slash command the
  box began with is replaced.
- **`?>`** opens the command's description on the lines below, at the pane's
  full width; `?v` or the description closes it. One is open at a time.
- **☆** pins the command; **★** unpins it, from Pinned or its own group.

Press a group's header to open or close it. Pinned, Project and User start
open; the rest, and each plugin's sub-group, start closed. The pins and which
groups are open are kept in the mod's store, across sessions and projects. A
pinned command a session does not have is hidden there, not dropped. **↻**
lists the commands again; they are also read again after each turn.

## Commands

| Command | Description |
|---------|-------------|
| `/hud` | Open the pane |
