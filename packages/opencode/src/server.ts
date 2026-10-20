import type { Plugin } from '@opencode/plugin'
import { setTimeout as delay } from 'node:timers/promises'
import { createPanel, type Panel } from './panel.ts'
import { PanelRpc, type FixTarget, type PanelState } from './rpc.ts'
import { runner } from './process.ts'

type Input = { sessionID: string; args?: string; url?: string; method?: 'squash' | 'merge' | 'rebase' | null; action?: Parameters<Panel['prepare']>[0]; token?: string; target?: FixTarget }
type Settings = { enabled?: boolean; now?: () => number; idleMs?: number; schedule?: (sweep: () => Promise<void>) => () => void }
type Entry = {
  promise: Promise<Panel>
  controller: AbortController
  touched: number
  validated: number
  dirty: boolean
  timer?: ReturnType<typeof setTimeout>
  saving?: Promise<void>
  flush: () => Promise<void>
}

export async function setupPanel(ctx: Plugin.Context, createRun = runner, settings: Settings = {}) {
  if (settings.enabled === false) {
    const disabled = async () => { throw new Error('PR panel is disabled on this server') }
    await ctx.rpc.register(PanelRpc, {
      status: async () => ({ enabled: false }), state: disabled, command: disabled,
      select: disabled, refresh: disabled, method: disabled, prepare: disabled, action: disabled, fix: disabled,
    })
    return async () => {}
  }
  const now = settings.now ?? Date.now
  const idleMs = settings.idleMs ?? 60_000
  const abort = new AbortController()
  const sessions = new Map<string, Entry>()
  const report = (error: unknown) => { if (!abort.signal.aborted) console.error('pr-panel:', error) }
  let registration: Awaited<ReturnType<typeof ctx.rpc.register<typeof PanelRpc>>>

  const drop = (sessionID: string) => {
    const entry = sessions.get(sessionID)
    if (entry) { entry.controller.abort(); clearTimeout(entry.timer); sessions.delete(sessionID) }
    return entry
  }
  const validate = async (sessionID: string) => {
    // A network/storage/service error is not evidence that a session disappeared.
    // In particular, it must not abort an already-confirmed gh mutation.
    const session = await ctx.session.get({ sessionID }).catch(error => {
      if (error && typeof error === 'object' && '_tag' in error && error._tag === 'SessionNotFoundError') drop(sessionID)
      throw error
    })
    if (session.location.directory !== ctx.location.directory || session.parentID) {
      drop(sessionID)
      throw new Error(session.parentID ? 'PR panels belong to root sessions' : 'PR-panel request belongs to another location')
    }
    return session
  }
  const rootSessionID = async (sessionID: string) => {
    const visited = new Set<string>()
    while (!visited.has(sessionID)) {
      visited.add(sessionID)
      const session = await ctx.session.get({ sessionID })
      if (!session.parentID) return sessionID
      sessionID = session.parentID
    }
    throw new Error('Session parent cycle')
  }

  const ensure = async (sessionID: string): Promise<Panel> => {
    const session = await validate(sessionID)
    if (abort.signal.aborted) throw new Error('PR panel unloaded')
    const existing = sessions.get(sessionID)
    if (existing) { existing.touched = now(); existing.validated = now(); return existing.promise }
    const controller = new AbortController()
    const signal = AbortSignal.any([abort.signal, controller.signal])
    let entry: Entry
    const promise = Promise.resolve().then(async () => {
      const saved = await ctx.storage.get(`session/${sessionID}`) as PanelState | undefined
      const run = createRun(session.location.directory, signal)
      const panel = createPanel({
        run: async (argv, timeout) => {
          if ((argv[1] === 'pr' && ['merge', 'ready'].includes(argv[2])) || (argv[1] === 'run' && argv[2] === 'rerun')) {
            await ctx.permission.assert({ sessionID, action: 'shell', resources: [argv.join(' ')] })
          }
          return run(argv, timeout)
        },
        changed: () => {
          if (signal.aborted) return
          entry.dirty = true
          if (!entry.timer) entry.timer = setTimeout(() => { entry.timer = undefined; void entry.flush().catch(report) }, 25)
        },
        notify: async (text, title, important) => {
          if (!signal.aborted) await registration.events.emit('notice', { sessionID, text, title, important })
        },
        tellAgent: async text => {
          if (signal.aborted) return
          await validate(sessionID)
          await ctx.session.prompt({ sessionID, text, delivery: 'queue' })
        },
      }, saved)
      await panel.start()
      return panel
    })
    const flush = (): Promise<void> => {
      clearTimeout(entry.timer)
      entry.timer = undefined
      if (entry.saving) return entry.saving
      if (!entry.dirty || controller.signal.aborted) return Promise.resolve()
      entry.saving = (async () => {
        const panel = await promise
        while (entry.dirty && !controller.signal.aborted) {
          entry.dirty = false
          // Clone once per batch, at flush time, not once per small state edit.
          const state = structuredClone(panel.state)
          try {
            await ctx.storage.set(`session/${sessionID}`, state)
            if (!controller.signal.aborted) await registration.events.emit('updated', { sessionID, state })
          } catch (error) { entry.dirty = true; throw error }
        }
      })().finally(() => { entry.saving = undefined })
      return entry.saving
    }
    entry = { promise, controller, touched: now(), validated: now(), dirty: false, flush }
    sessions.set(sessionID, entry)
    void promise.catch(() => { if (sessions.get(sessionID) === entry) drop(sessionID) })
    return promise
  }
  const withPanel = async (value: unknown, fn: (panel: Panel, input: Input) => Promise<object> | object) => {
    const input = value as Input
    return fn(await ensure(input.sessionID), input)
  }
  registration = await ctx.rpc.register(PanelRpc, {
    status: async () => ({ enabled: true }),
    state: value => withPanel(value, panel => structuredClone(panel.state)),
    command: value => withPanel(value, async (panel, input) => ({ text: await panel.command(input.args!, input.url) })),
    select: value => withPanel(value, async (panel, input) => { await panel.select(input.url!); return {} }),
    refresh: value => withPanel(value, async (panel, input) => { await panel.refresh(input.url!); return {} }),
    method: value => withPanel(value, async (panel, input) => { await panel.method(input.url!, input.method!); return {} }),
    prepare: value => withPanel(value, (panel, input) => panel.prepare(input.action!, input.url!, input.method)),
    action: value => withPanel(value, async (panel, input) => { await panel.action(input.token!); return {} }),
    fix: value => withPanel(value, async (panel, input) => ({ text: await panel.fix(input.target!) })),
  })

  await ctx.session.hook('prompt', event => {
    void ctx.session.get({ sessionID: event.sessionID }).then(session => {
      if (!session.parentID) return ensure(event.sessionID)
    }).catch(report)
  })
  await ctx.tool.hook('execute.after', event => {
    if (event.status !== 'completed' || event.tool !== 'shell') return
    const input = event.input as { command?: string } | undefined
    if (!input?.command || !/\b(?:gh|git)\b/.test(input.command)) return
    const content = event.result.content ?? ''
    const output = (typeof content === 'string' ? content : JSON.stringify(content)) ?? ''
    void rootSessionID(event.sessionID).then(ensure).then(panel => panel.observe(input.command!, output)).catch(report)
  })

  const sweep = async () => {
    await Promise.all([...sessions].map(async ([sessionID, entry]) => {
      try {
        const panel = await entry.promise
        if (sessions.get(sessionID) !== entry) return
        if (!panel.state.prs.length && !panel.active()) {
          if (now() - entry.touched >= idleMs) {
            await entry.flush()
            if (sessions.get(sessionID) === entry && !panel.active() && now() - entry.touched >= idleMs) drop(sessionID)
          }
          return
        }
        // Lifecycle events do most cleanup. Periodic validation recovers missed
        // events after reconnects without session.get on every five-second tick.
        if (now() - entry.validated >= 60_000) { await validate(sessionID); entry.validated = now() }
        await panel.tick()
      } catch (error) { report(error) }
    }))
  }
  const stop = settings.schedule ? settings.schedule(sweep) : (() => {
    const timer = setInterval(() => { void sweep() }, 5_000)
    timer.unref()
    return () => clearInterval(timer)
  })()
  const events = (async () => {
    while (!abort.signal.aborted) {
      try {
        for await (const event of ctx.event.subscribe({ signal: abort.signal })) {
          try {
            if (event.type !== 'session.deleted' && event.type !== 'session.moved') continue
            const { sessionID } = event.data
            const entry = drop(sessionID)
            if (event.type === 'session.deleted') {
              await entry?.saving?.catch(report)
              await ctx.storage.remove(`session/${sessionID}`)
            }
          } catch (error) { report(error) } // One failed removal must not kill lifecycle cleanup.
        }
      } catch (error) { report(error) }
      if (!abort.signal.aborted) await delay(1_000, undefined, { signal: abort.signal }).catch(() => {})
    }
  })()
  return async () => {
    stop()
    abort.abort()
    await events
    await Promise.allSettled([...sessions.values()].map(async entry => { await entry.promise; await entry.flush() }))
    sessions.clear()
  }
}
