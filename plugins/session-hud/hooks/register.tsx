import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

import type { CommandRow, Place, Section, Status, Usage } from '../types'
import { ASKS_PERSON, GROUPS, IDLE, classify, promptLine, repoName, tildePath, toolDetail, togglePin, withCommand } from './model'
import { renderHud } from './view'

const PANE = 'session-hud'
const TITLE = 'hud'
/** The width asked for while docked; the person's own resize wins. */
const PANE_COLUMNS = 44

// Atoms live here: the engine reads which state a module touches from the file that spells `$`.
const place = atom({ plugin: 'session-hud', key: 'place' } as const, null as Place | null)
const usage = atom({ plugin: 'session-hud', key: 'usage' } as const, null as Usage | null)
const commands = atom({ plugin: 'session-hud', key: 'commands' } as const, [] as CommandRow[])
const status = atom({ plugin: 'session-hud', key: 'status' } as const, IDLE as Status)
const now = atom({ plugin: 'session-hud', key: 'now' } as const, 0)
const open = atom({ plugin: 'session-hud', key: 'open' } as const, {} as Partial<Record<Section, boolean>>)
const pins = atom({ plugin: 'session-hud', key: 'pins' } as const, [] as string[])

/** The store's keys for the pins and the open sections, kept across sessions. */
const STORE_PINS = 'pins'
const STORE_OPEN = 'open'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The stored open sections, each a boolean; anything else in the store is dropped. */
const asOpen = (value: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(value).filter(([, isOpen]) => typeof isOpen === 'boolean')) as Partial<Record<Section, boolean>>

const loadOpen = async ($: EngineInterface) => {
  const kept = await $.store.get(STORE_OPEN)
  if (isRecord(kept)) await update($, open, all => ({ ...all, ...asOpen(kept) }))
}

const loadPins = async ($: EngineInterface) => {
  const kept = await $.store.get(STORE_PINS)
  if (Array.isArray(kept)) await update($, pins, () => kept.filter((name): name is string => typeof name === 'string'))
}
const notice = atom({ plugin: 'session-hud', key: 'notice' } as const, null as string | null)
const expanded = atom({ plugin: 'session-hud', key: 'expanded' } as const, null as string | null)

const configDir = async ($: EngineInterface) =>
  (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('HOME')) ?? ''}/.claude`

const resolvePlace = async ($: EngineInterface): Promise<Place> => {
  const cwd = await $.session.cwd()
  const repo = await $.session.repo().catch(() => null)
  const branch = await $.process
    .run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 3_000 })
    .catch(() => null)
  return {
    cwd,
    path: tildePath(cwd, await $.env.get('HOME')),
    repo: repo ? repoName(repo) : null,
    branch: branch?.exitCode === 0 ? branch.stdout.trim() || null : null,
    sessionId: await $.session.id(),
    model: await $.session.model(),
  }
}

const refreshPlace = async ($: EngineInterface) => {
  const next = await resolvePlace($).catch(() => null)
  if (next) await update($, place, () => next)
}

const toUsage = (figures: {
  startedAt?: number
  context: SessionContextUsage
  rateLimits: SessionRateLimit[]
  cost?: SessionCost
}, startedAt: number): Usage => ({
  startedAt: figures.startedAt ?? startedAt,
  contextTokens: figures.context.tokens ?? null,
  contextWindow: figures.context.window,
  contextPercent: figures.context.percent ?? null,
  rateLimits: figures.rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, ...(resetsAt ? { resetsAt } : {}) })),
  costUsd: figures.cost?.usd ?? null,
})

const refreshUsage = async ($: EngineInterface) => {
  const figures = await $.session.usage().catch(() => null)
  if (figures) await update($, usage, () => toUsage(figures, figures.startedAt))
}

/** The command and skill names a `.claude` folder adds: `skills/<name>/` and `commands/<dir>/<name>.md` as `dir:name`. */
const namesIn = async ($: EngineInterface, claudeDir: string) => {
  const names = new Set<string>()
  const list = (path: string) => $.fs.list(path).catch(() => [])
  for (const entry of await list(`${claudeDir}/skills`)) {
    if (entry.kind !== 'file') names.add(entry.name)
  }
  const walk = async (dir: string, prefix: string, depth: number) => {
    for (const entry of await list(dir)) {
      if (entry.kind === 'file' && entry.name.endsWith('.md')) names.add(prefix + entry.name.slice(0, -3))
      else if (entry.kind === 'dir' && depth < 3) await walk(`${dir}/${entry.name}`, `${prefix}${entry.name}:`, depth + 1)
    }
  }
  await walk(`${claudeDir}/commands`, '', 0)
  return names
}

const refreshCommands = async ($: EngineInterface) => {
  const listed = await $.command.list()
  const cwd = await $.session.cwd()
  const root = await $.session.root()
  const project = new Set<string>()
  // The working folder and the project's root may differ (a subfolder): both count as the project's.
  for (const dir of new Set([cwd, root])) for (const name of await namesIn($, `${dir}/.claude`)) project.add(name)
  const user = await namesIn($, await configDir($))
  await update($, commands, () => classify(listed, { project, user }))
}

const setStatus = ($: EngineInterface, fn: (s: Status) => Status) => update($, status, fn)

const openPane = async ($: EngineInterface) => {
  await update($, now, () => Date.now())
  const opened = await $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })
  if (!opened.isPlaced) return `Session HUD is open but waits undrawn: ${opened.reason}`
  return 'Session HUD opened.'
}

/** When the pane's clock last moved, kept per module: a reload starts it over. */
const ticker = { lastTick: 0 }

/** The elapsed times tick while the pane shows: every second while a turn runs, every 15 seconds idle. */
const tick = async ($: EngineInterface) => {
  const at = await $.clock.now()
  const phase = (await read($, status)).phase
  if (phase === 'idle' && at - ticker.lastTick < 15_000) return
  const panes = await $.ui.panes()
  if (!panes.some(pane => pane.id === PANE && pane.isShown)) return
  ticker.lastTick = at
  await update($, now, () => at)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'hud',
      description: 'Show the session HUD pane: context, usage, status, and skills and commands to insert',
    })
    // A reload keeps the state but not the timer: started once per module.
    $.clock.every(1_000, () => void tick($).catch(() => undefined))
    void refreshPlace($)
    void refreshUsage($)
    void refreshCommands($).catch(error => update($, notice, () => `Could not list commands: ${String(error)}`))
    void loadPins($).catch(() => undefined)
    void loadOpen($).catch(() => undefined)
    return started
  }).catch(($, e, next) => next(e))

  // /clear, /resume and /branch start a new conversation in this window.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    const started = await next(e)
    await update($, status, () => IDLE)
    void refreshPlace($)
    void refreshUsage($)
    return started
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    const startedAt = (await read($, usage))?.startedAt ?? (await $.session.usage()).startedAt
    await update($, usage, () => toUsage(e, startedAt))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const at = await $.clock.now()
      await update($, now, () => at)
      await setStatus($, s => ({
        ...s,
        phase: 'working',
        since: at,
        turnStartedAt: at,
        prompt: promptLine(e.text),
        tool: null,
        toolDetail: '',
        toolCount: 0,
      }))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const input = e as unknown as Record<string, unknown>
    const isAgent = e.tool === 'Agent'
    const at = await $.clock.now()
    await setStatus($, s => ({
      ...s,
      ...(ASKS_PERSON.has(e.tool) ? { phase: 'waiting' as const, since: at } : {}),
      tool: e.tool,
      toolDetail: toolDetail(e.tool, input),
      toolCount: s.toolCount + 1,
      agents: s.agents + (isAgent ? 1 : 0),
    }))
    try {
      return await next(e)
    } finally {
      await setStatus($, s => ({
        ...s,
        ...(s.phase === 'waiting' ? { phase: 'working' as const, since: s.turnStartedAt || s.since } : {}),
        tool: s.tool === e.tool ? null : s.tool,
        toolDetail: s.tool === e.tool ? '' : s.toolDetail,
        agents: Math.max(0, s.agents - (isAgent ? 1 : 0)),
      }))
    }
  }).catch(($, e, next) => next(e))

  // A call put to the person waits on them until the tool runs (or is refused).
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (e.agentId === undefined && verdict.decision === 'ask') {
      const at = await $.clock.now()
      await setStatus($, s => (s.phase === 'working' ? { ...s, phase: 'waiting', since: at } : s))
    }
    return verdict
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      const at = await $.clock.now()
      await update($, now, () => at)
      await setStatus($, s => ({
        ...s,
        phase: 'idle',
        since: at,
        lastDurationMs: e.durationMs,
        turnStartedAt: 0,
        tool: null,
        toolDetail: '',
        lastReason: e.reason,
      }))
      // A turn may have switched branches or worktrees, or written a new skill.
      void refreshPlace($)
      void refreshUsage($)
      void refreshCommands($).catch(() => undefined)
    }
    return done
  }).catch(($, e, next) => next(e))

  // /model changes what the context line says.
  on('command.run', { command: 'model' }, async ($, e, next) => {
    const ran = await next(e)
    void refreshPlace($)
    return ran
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'hud' }, async $ => ({ text: await openPane($) })).catch(() => ({
    text: 'session-hud: /hud failed; see the debug log.',
  }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const model = {
      place: await read($, place),
      usage: await read($, usage),
      commands: await read($, commands),
      status: await read($, status),
      // The tick is read so it redraws the pane; the times are drawn from the clock itself.
      now: ((await read($, now)), await $.clock.now()),
      open: await read($, open),
      pins: await read($, pins),
      notice: await read($, notice),
      expanded: await read($, expanded),
    }
    return renderHud($.ui.resolve(e), model, {
      insert: name =>
        void (async () => {
          const draft = await $.prompt.read().catch(() => ({ text: '' }))
          const text = withCommand(name, draft.text)
          const filled = await $.prompt.fill({ text, mode: 'replace', cursor: text.length })
          if (!filled.isFilled) await update($, notice, () => 'Could not put the command in the prompt box.')
        })(),
      toggle: section =>
        void (async () => {
          // A plugin's sub-group, as any group not listed, starts closed.
          const isOpenByDefault = GROUPS.find(one => one.scope === section)?.isOpenByDefault ?? false
          // Read from the store, so a section another session opened or closed meanwhile keeps that.
          const kept = await $.store.get(STORE_OPEN).catch(() => undefined)
          const base = isRecord(kept) ? { ...(await read($, open)), ...asOpen(kept) } : await read($, open)
          const next = { ...base, [section]: !(base[section] ?? isOpenByDefault) }
          await update($, open, () => next)
          await $.store.set(STORE_OPEN, next).catch(() => undefined)
        })(),
      pin: name =>
        void (async () => {
          // Read from the store, so a pin another session made meanwhile is kept.
          const kept = await $.store.get(STORE_PINS).catch(() => undefined)
          const base = Array.isArray(kept) ? kept.filter((one): one is string => typeof one === 'string') : await read($, pins)
          const next = togglePin(base, name)
          await update($, pins, () => next)
          await $.store.set(STORE_PINS, next).catch(() => update($, notice, () => 'Could not save the pins; they last this session only.'))
        })(),
      refresh: () =>
        void (async () => {
          await refreshCommands($).catch(error => update($, notice, () => `Could not list commands: ${String(error)}`))
          await refreshUsage($)
          await refreshPlace($)
        })(),
      dismissNotice: () => void update($, notice, () => null),
      // Opening one closes the other; pressing the open one again closes it.
      expand: id => void update($, expanded, current => (current === id ? null : id)),
    })
  })
}
