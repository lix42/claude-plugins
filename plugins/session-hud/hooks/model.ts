import type { CommandInfo } from 'claude-code'

import type { Activity, CommandRow, Group, LiveSession, Scope, Status } from '../types'

export const IDLE: Status = {
  phase: 'idle',
  since: 0,
  turnStartedAt: 0,
  prompt: '',
  tool: null,
  toolDetail: '',
  toolCount: 0,
  agents: 0,
  lastDurationMs: null,
  lastReason: null,
}

/** `42s`, `3m05s`, `1h12m`. */
export const elapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(h / 24)}d${String(h % 24).padStart(2, '0')}h`
}

/** `12.3k`, `1.2M`. */
export const tokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n)

/** A bar of `width` cells, filled to `percent`. */
export const bar = (percent: number, width = 10) => {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export const levelColor = (percent: number) => (percent >= 90 ? 'error' : percent >= 70 ? 'warning' : 'success')

/**
 * Whether the session draws on extra usage (paid past the plan): a plan window
 * at or past its limit, or a gateway's spend limit, which bills every call.
 * The engine reports no such flag, so this reads it from the windows.
 */
export const isOnExtraUsage = (limits: readonly { kind: string; percentUsed: number }[]) =>
  limits.some(limit => limit.kind === 'spend_limit' || limit.percentUsed >= 100)

export const LIMIT_LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

/** `in 2h13m` until an ISO time, or '' when there is none or it passed. */
export const resetsIn = (iso: string | undefined, now: number) => {
  if (!iso) return ''
  const at = Date.parse(iso)
  return Number.isFinite(at) && at > now ? `resets in ${elapsed(at - now).replace(/\d+s$/, '') || '<1m'}` : ''
}

export const tildePath = (path: string, home: string | undefined) =>
  home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path

const oneLine = (text: string, max = 80) => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

const basename = (path: string) => path.replace(/\/+$/, '').split('/').pop() || path

/**
 * The repository as `owner/name`: the engine's name when it has one (only for
 * repositories it treats as its own), else the origin remote's path
 * (`https://host/owner/name.git`, `git@host:owner/name.git`), else the root folder's name.
 */
export const repoName = (repo: { root: string; remote: string | null; name: string | null }) => {
  if (repo.name) return repo.name
  const path = repo.remote?.match(/^(?:[a-z+]+:\/\/[^/]+\/|[^@/]+@[^:/]+:)(.+?)(?:\.git)?\/*$/i)?.[1]
  return path || basename(repo.root)
}

/** A short word on what a tool call is doing: the command, the file, the pattern. */
export const toolDetail = (tool: string, input: Record<string, unknown>) => {
  const str = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '')
  switch (tool) {
    case 'Bash':
      return oneLine(str('description') || str('command'))
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return basename(str('file_path') || str('notebook_path'))
    case 'Grep':
    case 'Glob':
      return oneLine(str('pattern'))
    case 'Skill':
      return str('skill')
    case 'Agent':
    case 'Task':
      return oneLine(str('description') || str('subagent_type'))
    case 'WebFetch':
      return oneLine(str('url'))
    case 'WebSearch':
      return oneLine(str('query'))
    default:
      return ''
  }
}

/** Tools that stop for the person rather than run. */
export const ASKS_PERSON = new Set(['AskUserQuestion', 'ExitPlanMode'])

export const promptLine = (text: string) => oneLine(text, 120)

/** The names the files under a `.claude` folder add: `skills/<name>/`, `commands/<a>/<b>.md` as `a:b`. */
export type Found = { project: ReadonlySet<string>; user: ReadonlySet<string> }

/**
 * Sorts the session's commands into the pane's groups. `user` source covers
 * both the project's and the user's own files: the names found on disk tell
 * them apart, a project's winning, and a name found in neither counts as the user's.
 */
export const classify = (list: readonly CommandInfo[], found: Found): CommandRow[] =>
  list.map(command => {
    const scope: Scope =
      command.source === 'builtin'
        ? 'builtin'
        : command.source === 'mcp'
          ? 'mcp'
          : command.source === 'plugin'
            ? 'plugin'
            : found.project.has(command.name)
              ? 'project'
              : 'user'
    return {
      name: command.name,
      description: command.description,
      scope,
      ...(command.plugin ? { plugin: command.plugin } : {}),
    }
  })

export const GROUPS: readonly { scope: Group; title: string; isOpenByDefault: boolean }[] = [
  { scope: 'pinned', title: 'Pinned', isOpenByDefault: true },
  { scope: 'project', title: 'Project', isOpenByDefault: true },
  { scope: 'user', title: 'User', isOpenByDefault: true },
  { scope: 'plugin', title: 'Plugins', isOpenByDefault: false },
  { scope: 'mcp', title: 'MCP', isOpenByDefault: false },
  { scope: 'builtin', title: 'Built-in', isOpenByDefault: false },
]

/** The rows a group lists: a scope's own, or the pinned ones in the order pinned (a pin not in this session left out). */
export const rowsOf = (group: Group, commands: readonly CommandRow[], pins: readonly string[]) =>
  group === 'pinned'
    ? pins.flatMap(name => commands.find(row => row.name === name) ?? [])
    : commands.filter(row => row.scope === group)

/** The plugin rows split by plugin, plugins by name; a row whose plugin is unknown under `other`. */
export const byPlugin = (rows: readonly CommandRow[]) => {
  const plugins = new Map<string, CommandRow[]>()
  for (const row of rows) {
    const name = row.plugin ?? 'other'
    plugins.set(name, [...(plugins.get(name) ?? []), row])
  }
  return [...plugins].sort(([a], [b]) => a.localeCompare(b))
}

/** The pins after a press on a command's pin: added last, or taken out. */
export const togglePin = (pins: readonly string[], name: string) =>
  pins.includes(name) ? pins.filter(pin => pin !== name) : [...pins, name]

/**
 * What the prompt box holds after a press on `/name`: the command, then the
 * draft as its arguments, a slash command the draft began with replaced.
 */
export const withCommand = (name: string, draft: string) => {
  const rest = draft.replace(/^\s*\/\S*\s*/, '').trimStart()
  return `/${name} ${rest}`
}

/** Reads `claude agents --json`: the running sessions by session id; null for output it cannot read. */
export const parseAgents = (stdout: string): Record<string, LiveSession> | null => {
  let rows: unknown
  try {
    rows = JSON.parse(stdout)
  } catch {
    return null
  }
  if (!Array.isArray(rows)) return null
  const str = (value: unknown) => (typeof value === 'string' ? value : null)
  const sessions: Record<string, LiveSession> = {}
  for (const row of rows as Record<string, unknown>[]) {
    const sessionId = str(row?.sessionId)
    if (!sessionId) continue
    sessions[sessionId] = {
      sessionId,
      shortId: str(row.id),
      name: str(row.name) ?? '',
      kind: str(row.kind) ?? '',
      status: str(row.status) ?? '',
      state: str(row.state),
      startedAt: typeof row.startedAt === 'number' ? row.startedAt : null,
    }
  }
  return sessions
}

/** How a background session stands, in a word, and the color it is drawn in. */
export const liveState = (session: LiveSession | undefined): { mark: string; word: string; color?: string } => {
  if (!session) return { mark: '○', word: 'not read yet' }
  if (session.state === 'done') return { mark: '✓', word: 'done', color: 'success' }
  if (session.state === 'blocked') return { mark: '◐', word: 'waiting for you', color: 'permission' }
  if (session.status === 'busy' || session.state === 'working') return { mark: '●', word: 'working', color: 'warning' }
  return { mark: '○', word: 'idle' }
}

/**
 * What a session was last doing, from the records at the end of its
 * transcript (oldest first): its `last-prompt` record, its assistant messages
 * (each tool call the latest step) and the `turn_duration` record that ends a turn.
 * A turn's start is known only from a turn's end before it: with none in the
 * records, the turn running started before them, and its start stays null.
 */
export const readActivity = (lines: readonly string[]): Activity => {
  const activity: Activity = { prompt: '', tool: null, toolDetail: '', turnStartedAt: null, lastAt: null }
  // Unknown until a turn's end is seen: the first step in the records need not be its turn's first.
  let isTurnOver: boolean | null = null
  for (const line of lines) {
    let record: Record<string, unknown>
    try {
      record = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (record.isSidechain === true) continue
    const at = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN
    if (record.type === 'last-prompt' && typeof record.lastPrompt === 'string') {
      activity.prompt = promptLine(record.lastPrompt)
      continue
    }
    if (record.type === 'system' && record.subtype === 'turn_duration') {
      isTurnOver = true
      activity.tool = null
      activity.toolDetail = ''
      activity.turnStartedAt = null
      if (Number.isFinite(at)) activity.lastAt = at
      continue
    }
    const message = record.message as { role?: unknown; content?: unknown } | undefined
    if (message?.role !== 'assistant') continue
    if (Number.isFinite(at)) {
      if (isTurnOver === true) activity.turnStartedAt = at
      activity.lastAt = at
    }
    // The turn's end, when it was seen, dates it; a step seen before any turn's end leaves it unknown.
    if (isTurnOver === true) isTurnOver = false
    for (const part of Array.isArray(message.content) ? (message.content as Record<string, unknown>[]) : []) {
      if (part?.type === 'tool_use' && typeof part.name === 'string') {
        activity.tool = part.name
        activity.toolDetail = toolDetail(part.name, (part.input ?? {}) as Record<string, unknown>)
      } else if (part?.type === 'text') {
        // Text after a tool call: the tool is done and the turn is answering.
        activity.tool = null
        activity.toolDetail = ''
      }
    }
  }
  return activity
}

/** Splits the activity script's output into each session's lines, by the `@@@ <id>` line heading them. */
export const splitBySession = (stdout: string) => {
  const sessions: Record<string, string[]> = {}
  let current: string[] | null = null
  for (const line of stdout.split('\n')) {
    const head = /^@@@ (\S+)$/.exec(line)
    if (head) sessions[head[1]!] = current = []
    else if (current && line) current.push(line)
  }
  return sessions
}
