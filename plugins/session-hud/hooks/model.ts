import type { CommandInfo } from 'claude-code'

import type { CommandRow, Group, Scope, Status } from '../types'

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
