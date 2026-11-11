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
    }
  }
}
