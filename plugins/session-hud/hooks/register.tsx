import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

import type { Activity, CommandRow, LiveSession, Place, Section, Status, Usage } from '../types'
import {
  ASKS_PERSON,
  GROUPS,
  IDLE,
  classify,
  parseAgents,
  promptLine,
  readActivity,
  repoName,
  splitBySession,
  tildePath,
  toolDetail,
  togglePin,
  withCommand,
} from './model'
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

/** The store's keys, kept across sessions: the pins, the open sections, and the sessions whose HUD is open. */
const STORE_PINS = 'pins'
const STORE_OPEN = 'open'
const STORE_OPEN_PANES = 'openPanes'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The stored open sections, each a boolean; anything else in the store is dropped. */
const asOpen = (value: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(value).filter(([, isOpen]) => typeof isOpen === 'boolean')) as Partial<Record<Section, boolean>>

const loadOpen = async ($: EngineInterface) => {
  const kept = await $.store.get(STORE_OPEN)
  if (isRecord(kept)) await update($, open, all => ({ ...all, ...asOpen(kept) }))
}

const asPins = (value: unknown) => (Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string') : [])

const loadPins = async ($: EngineInterface) => {
  const kept = await $.store.get(STORE_PINS)
  if (Array.isArray(kept)) await update($, pins, () => asPins(kept))
}

/**
 * Changes one value of the store as it stands right before the write, so what
 * another session wrote meanwhile is kept; resolves the new value. `parse`
 * reads the stored value, whatever shape it has. The store has no
 * compare-and-set: two writes in the same instant can still lose one.
 */
const changeStored = async <T,>($: EngineInterface, key: string, parse: (value: unknown) => T, fn: (value: T) => T) => {
  // A failed read rejects before anything is written: taken as empty, it would overwrite what is stored.
  const next = fn(parse(await $.store.get(key)))
  await $.store.set(key, next)
  return next
}
const notice = atom({ plugin: 'session-hud', key: 'notice' } as const, null as string | null)
const expanded = atom({ plugin: 'session-hud', key: 'expanded' } as const, null as string | null)
const live = atom({ plugin: 'session-hud', key: 'live' } as const, null as Record<string, LiveSession> | null)
const forks = atom({ plugin: 'session-hud', key: 'forks' } as const, [] as string[])
const activity = atom({ plugin: 'session-hud', key: 'activity' } as const, {} as Record<string, Activity>)

/** Values fixed for the process: read once. */
const fixed: { configDir?: string } = {}

const configDir = async ($: EngineInterface) =>
  (fixed.configDir ??= (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('HOME')) ?? ''}/.claude`)

/** Shell: sets `f` to session `$id`'s transcript under the config folder `$d`, or to '' (as session-compass finds one). */
const FIND_TRANSCRIPT = 'f=$(ls "$d"/projects/*/"$id".jsonl 2>/dev/null | head -n 1)'

/**
 * Prints, for each candidate session given after the config folder and this
 * session's id, `+<id>` when its transcript starts with the same message as
 * this session's (a fork's starts with the copy of its parent's), `-<id>` when
 * it starts otherwise, and nothing while it has no transcript yet.
 */
const LINEAGE_SCRIPT =
  'd="$1"; shift; ' +
  `first() { id="$1"; ${FIND_TRANSCRIPT}; [ -n "$f" ] && grep -m 1 -o '"uuid":"[^"]*"' "$f"; }; ` +
  'mine=$(first "$1"); shift; [ -n "$mine" ] || exit 0; ' +
  'for c in "$@"; do u=$(first "$c"); [ -n "$u" ] || continue; if [ "$u" = "$mine" ]; then echo "+$c"; else echo "-$c"; fi; done; exit 0'

/**
 * Prints, for each session id given after the config folder, `@@@ <id>` and
 * then the records at the end of its transcript that say what it does: its
 * latest prompt, its assistant messages and its turns' ends (subagents' left
 * out, and the large request records the filter would otherwise wade through).
 */
const ACTIVITY_SCRIPT =
  'd="$1"; shift; for id in "$@"; do ' +
  `${FIND_TRANSCRIPT}; [ -n "$f" ] || continue; echo "@@@ $id"; ` +
  `r=$(tail -c 1000000 "$f" | grep -v -e '^{"type":"api-request' -e '"isSidechain":true' | ` +
  `grep -e '^{"type":"last-prompt"' -e '"role":"assistant"' -e '"subtype":"turn_duration"'); ` +
  // First the last turn's end and the step after it, which a long turn pushes out of the last 12: they date the turn running.
  `printf '%s\\n' "$r" | awk '/"subtype":"turn_duration"/ { e = $0; s = ""; next } /"role":"assistant"/ { if (s == "") s = $0 } END { if (e != "") print e; if (s != "") print s }'; ` +
  `printf '%s\\n' "$r" | tail -n 12; ` +
  'done; exit 0'

/**
 * Whether each running session seen is a fork of this conversation. A
 * session's history does not change, so each is checked once, for as long as
 * this session is the one running (/clear starts another).
 */
const lineage = { of: '', related: new Map<string, boolean>() }

/** When the running sessions were last read, whether a read is under way, and whether another was asked for meanwhile. */
const sessionsRead = { isRunning: false, isRerunWanted: false, lastAt: 0 }

/** The state each fork's activity was last read in: a fork read as done has nothing more to read. */
const activityReadIn = new Map<string, string | null>()

/**
 * Reads the running sessions (`claude agents --json`) and picks out this
 * conversation's forks: background sessions whose history starts like this
 * one's, whoever started them, so a restart finds them again. Then reads what
 * those not done yet are doing. One read at a time.
 */
const refreshSessions = async ($: EngineInterface): Promise<void> => {
  if (sessionsRead.isRunning) {
    // The read under way may have started before what asked for this one (a /fork): one more follows it.
    sessionsRead.isRerunWanted = true
    return
  }
  sessionsRead.isRunning = true
  sessionsRead.isRerunWanted = false
  try {
    sessionsRead.lastAt = await $.clock.now()
    const [ran, me, dir] = await Promise.all([
      $.process.run(['claude', 'agents', '--json'], { timeoutMs: 15_000 }).catch(() => null),
      $.session.id(),
      configDir($),
    ])
    const sessions = ran?.exitCode === 0 ? parseAgents(ran.stdout) : null
    if (!sessions) {
      const why = !ran ? 'it did not run (missing, failed to start, or timed out)' : ran.exitCode !== 0 ? `it exited ${ran.exitCode}` : 'its output was not a list of sessions'
      $.ui.log(`session-hud: claude agents --json could not be read: ${why}`, { to: 'debug' })
      // Unread rather than stale: the forks' rows say "not read yet" until a read succeeds.
      await update($, live, () => null)
      return
    }
    if (lineage.of !== me) {
      lineage.of = me
      lineage.related.clear()
    }
    const background = Object.values(sessions).filter(session => session.kind === 'background' && session.sessionId !== me)
    const unchecked = background.filter(session => !lineage.related.has(session.sessionId)).map(session => session.sessionId)
    if (unchecked.length > 0) {
      const checked = await $.process.run(['sh', '-c', LINEAGE_SCRIPT, 'sh', dir, me, ...unchecked], { timeoutMs: 10_000 }).catch(() => null)
      for (const line of checked?.exitCode === 0 ? checked.stdout.split('\n') : []) {
        if (line[0] === '+' || line[0] === '-') lineage.related.set(line.slice(1), line[0] === '+')
      }
    }
    const found = background
      .filter(session => lineage.related.get(session.sessionId) === true)
      .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
    await update($, live, () => sessions)
    await update($, forks, () => found.map(session => session.sessionId))
    await refreshActivity($, found, dir)
  } finally {
    sessionsRead.isRunning = false
    // Whatever this read came to, a failure included; started apart, so no chain of reads builds up.
    if (sessionsRead.isRerunWanted) void refreshSessions($).catch(() => undefined)
  }
}

/** Reads what the forks are doing from their transcripts: each not yet read since it was done. */
const refreshActivity = async ($: EngineInterface, found: readonly LiveSession[], dir: string) => {
  const known = await read($, activity)
  const ids = found
    // A fork done now and read as done has nothing new; one at work again (attached, prompted) is read again.
    .filter(session => !Object.hasOwn(known, session.sessionId) || session.state !== 'done' || activityReadIn.get(session.sessionId) !== 'done')
    .map(session => session.sessionId)
  const kept = new Set(found.map(session => session.sessionId))
  for (const id of activityReadIn.keys()) if (!kept.has(id)) activityReadIn.delete(id)
  const ran = ids.length > 0 ? await $.process.run(['sh', '-c', ACTIVITY_SCRIPT, 'sh', dir, ...ids], { timeoutMs: 10_000 }).catch(() => null) : null
  const fresh = ran?.exitCode === 0 ? splitBySession(ran.stdout) : {}
  for (const session of found) if (Object.hasOwn(fresh, session.sessionId)) activityReadIn.set(session.sessionId, session.state)
  // Forks no longer running drop out.
  await update($, activity, all =>
    Object.fromEntries([
      ...Object.entries(all).filter(([id]) => kept.has(id) && !Object.hasOwn(fresh, id)),
      ...Object.entries(fresh).map(([id, lines]) => [id, readActivity(lines)] as const),
    ]),
  )
}

/** Sessions whose open HUD the store remembers, the oldest dropping first. */
const MAX_OPEN_PANES = 50
/** Whether this session's HUD is to be open, as the store says; a module value, read again at each start. */
const paneWish = { isWanted: false, isRestoring: false }

/** Records whether the person wants this session's HUD open, in the store, so a new process opens it again. */
const wantPane = async ($: EngineInterface, isWanted: boolean) => {
  paneWish.isWanted = isWanted
  const id = await $.session.id()
  await changeStored($, STORE_OPEN_PANES, value => (isRecord(value) ? value : {}), ({ [id]: _old, ...others }) =>
    Object.fromEntries([...Object.entries(others), ...(isWanted ? [[id, true]] : [])].slice(-MAX_OPEN_PANES)),
  ).catch(() => undefined)
}

const isPaneWanted = async ($: EngineInterface) => {
  const [kept, id] = await Promise.all([$.store.get(STORE_OPEN_PANES).catch(() => undefined), $.session.id()])
  return isRecord(kept) && kept[id] === true
}

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
  void wantPane($, true).catch(() => undefined)
  const opened = await $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })
  if (!opened.isPlaced) return `Session HUD is open but waits undrawn: ${opened.reason}`
  return 'Session HUD opened.'
}

/** When the pane's clock last moved, kept per module: a reload starts it over. */
const ticker = { lastTick: 0 }

/** How often a HUD the person wants open, and that is not, is opened again. */
const RESTORE_EVERY_MS = 5_000
/** How often the running sessions are read while the pane shows. */
const SESSIONS_EVERY_MS = 10_000

/**
 * Opens the HUD again when the person wants it open and it is not: a session
 * left for another (the agent list) and come back to may draw without it.
 */
const restorePane = async ($: EngineInterface) => {
  // One at a time: the start and the timer may both find it missing.
  if (!paneWish.isWanted || paneWish.isRestoring) return
  paneWish.isRestoring = true
  try {
    if (!(await $.ui.panes()).some(pane => pane.id === PANE)) await $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })
  } finally {
    paneWish.isRestoring = false
  }
}

/**
 * While the pane shows: the elapsed times tick, every second while a turn runs
 * and every 15 seconds idle, and the running sessions are read every 10 seconds.
 */
const tick = async ($: EngineInterface) => {
  const at = await $.clock.now()
  const isIdle = (await read($, status)).phase === 'idle'
  const isTimeDue = !isIdle || at - ticker.lastTick >= 15_000
  const isSessionsDue = at - sessionsRead.lastAt >= SESSIONS_EVERY_MS
  if (!isTimeDue && !isSessionsDue) return
  // Counted as done even while the pane is hidden, so a hidden pane is asked about once a period.
  if (isSessionsDue) sessionsRead.lastAt = at
  if (!(await $.ui.panes()).some(pane => pane.id === PANE && pane.isShown)) return
  if (isSessionsDue) void refreshSessions($).catch(() => undefined)
  if (!isTimeDue) return
  ticker.lastTick = at
  await update($, now, () => at)
}

/** What the pane shows of the session, read again: after a start, a new conversation, a refresh. */
const refreshContext = ($: EngineInterface) => Promise.all([refreshUsage($), refreshPlace($)])

/** Everything the pane shows, read again: `$.state` starts over at a start and at each new conversation. */
const reloadState = ($: EngineInterface) => {
  void refreshContext($)
  void refreshCommands($).catch(error => update($, notice, () => `Could not list commands: ${String(error)}`))
  void loadPins($).catch(() => undefined)
  void loadOpen($).catch(() => undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'hud',
      description: 'Show the session HUD pane: context, usage, status, and skills and commands to insert',
    })
    // A reload keeps the state but not the timers: started once per module.
    $.clock.every(1_000, () => void tick($).catch(() => undefined))
    $.clock.every(RESTORE_EVERY_MS, () => void restorePane($).catch(() => undefined))
    // The HUD the person left open in this session opens again, in a new process too.
    void isPaneWanted($)
      .then(async isWanted => {
        paneWish.isWanted = isWanted
        if (isWanted) await restorePane($)
      })
      .catch(() => undefined)
    reloadState($)
    return started
  }).catch(($, e, next) => next(e))

  // /clear, /resume and /branch start a new conversation in this window.
  // Each resets every $.state value: what the pane shows is read again.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    const started = await next(e)
    await update($, status, () => IDLE)
    reloadState($)
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
      void refreshContext($)
      void refreshCommands($).catch(() => undefined)
    }
    return done
  }).catch(($, e, next) => next(e))

  // /fork starts the fork as a background session of its own: read as soon as its transcript is likely written.
  for (const command of ['fork', 'branch'])
    on('command.run', { command }, async ($, e, next) => {
      const ran = await next(e)
      void $.clock
        .sleep(2_000)
        .then(() => refreshSessions($))
        .catch(() => undefined)
      return ran
    }).catch(($, e, next) => next(e))

  // /model changes what the context line says.
  on('command.run', { command: 'model' }, async ($, e, next) => {
    const ran = await next(e)
    void refreshPlace($)
    return ran
  }).catch(($, e, next) => next(e))

  // Closed by the person: it stays closed, here and when the session comes back.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await wantPane($, false)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'hud' }, async $ => {
    void refreshSessions($).catch(() => undefined)
    return { text: await openPane($) }
  }).catch(() => ({
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
      live: await read($, live),
      forks: await read($, forks),
      activity: await read($, activity),
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
          const current = await read($, open)
          // On the store as it stands, so a section another session opened or closed meanwhile keeps that.
          const next = await changeStored($, STORE_OPEN, value => ({ ...current, ...(isRecord(value) ? asOpen(value) : {}) }), all => ({
            ...all,
            [section]: !(all[section] ?? isOpenByDefault),
          })).catch(() => ({ ...current, [section]: !(current[section] ?? isOpenByDefault) }))
          await update($, open, () => next)
        })(),
      pin: name =>
        void (async () => {
          // On the store as it stands, so a pin another session made meanwhile is kept.
          const next = await changeStored($, STORE_PINS, asPins, list => togglePin(list, name)).catch(async () => {
            await update($, notice, () => 'Could not save the pins; they last this session only.')
            return togglePin(await read($, pins), name)
          })
          await update($, pins, () => next)
        })(),
      refresh: () =>
        void (async () => {
          await refreshCommands($).catch(error => update($, notice, () => `Could not list commands: ${String(error)}`))
          await refreshContext($)
        })(),
      refreshStatus: () => void Promise.all([refreshSessions($), refreshContext($)]).catch(() => undefined),
      dismissNotice: () => void update($, notice, () => null),
      // Opening one closes the other; pressing the open one again closes it.
      expand: id => void update($, expanded, current => (current === id ? null : id)),
    })
  })
}
