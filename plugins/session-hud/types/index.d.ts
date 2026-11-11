/** Where a slash command comes from, as the pane groups them. */
export type Scope = 'project' | 'user' | 'plugin' | 'mcp' | 'builtin'

/** A group of the commands list: a scope, or the person's pins above them all. */
export type Group = Scope | 'pinned'

/** What can be opened and closed: a group, or one plugin's sub-group under Plugins (`plugin:<name>`). */
export type Section = Group | `plugin:${string}`

export type CommandRow = {
  name: string
  description: string
  scope: Scope
  /** The plugin that adds it, for `plugin` rows. */
  plugin?: string
}

export type Place = {
  cwd: string
  /** The cwd with the home folder as `~`. */
  path: string
  repo: string | null
  branch: string | null
  sessionId: string
  model: string
}

export type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }

export type Usage = {
  startedAt: number
  contextTokens: number | null
  contextWindow: number
  contextPercent: number | null
  rateLimits: RateLimit[]
  costUsd: number | null
}

/** What the main loop is doing: a turn running, a turn waiting on the person, or nothing. */
export type Phase = 'working' | 'waiting' | 'idle'

export type Status = {
  phase: Phase
  /** When the current phase began (ms since the epoch); 0 for never. */
  since: number
  /** When the running turn began; 0 when none runs. */
  turnStartedAt: number
  /** The prompt the running (or last) turn began with. */
  prompt: string
  /** The tool running now on the main loop, with a short detail. */
  tool: string | null
  toolDetail: string
  /** Tools the running (or last) turn called. */
  toolCount: number
  /** Subagents running now. */
  agents: number
  lastDurationMs: number | null
  lastReason: 'answer' | 'aborted' | 'refusal' | 'error' | null
}

/** One running session as `claude agents --json` lists it. */
export type LiveSession = {
  sessionId: string
  /** The short id `claude attach` takes, for a background session. */
  shortId: string | null
  name: string
  kind: string
  /** `idle` or `busy`. */
  status: string
  /** A background session's `working`, `blocked` (waiting for you) or `done`. */
  state: string | null
  /** When it started, ms since the epoch; null when not given. */
  startedAt: number | null
}

/** What another session of this conversation was last doing, as the end of its transcript tells. */
export type Activity = {
  /** Its latest prompt, one line; '' when none was found. */
  prompt: string
  /** The tool its turn runs now, with a short detail; null between tools or once the turn ended. */
  tool: string | null
  toolDetail: string
  /** When its running turn began; null when no turn runs. */
  turnStartedAt: number | null
  /** When it last did anything; null when nothing was found. */
  lastAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'session-hud': {
      place: Place | null
      usage: Usage | null
      commands: CommandRow[]
      status: Status
      /** The clock the elapsed times are drawn from, ticked while the pane shows. */
      now: number
      /** Which sections are open; the store keeps them across sessions. */
      open: Partial<Record<Section, boolean>>
      /** The pinned commands' names, in the order pinned; the store keeps them across sessions. */
      pins: string[]
      notice: string | null
      /** The command whose whole description is shown (`group:name`), or null: one at a time. */
      expanded: string | null
      /** The running sessions by session id, as last read; null before the first read. */
      live: Record<string, LiveSession> | null
      /** This conversation's forks running as background sessions, by session id, oldest first. */
      forks: string[]
      /** The forks' latest activity, by session id. */
      activity: Record<string, Activity>
    }
  }
}
