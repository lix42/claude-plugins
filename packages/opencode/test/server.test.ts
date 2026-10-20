import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Plugin } from '@opencode/plugin'
import { setupPanel } from '../src/server.ts'
import { GRAPH, REF, VIEW } from '../../../plugins/pr-panel/tests/fixtures'
import type { PanelState } from '../src/rpc.ts'

type Handler = (input: unknown) => Promise<unknown>

async function fake(enabled = true) {
  const stored = new Map<string, unknown>()
  const locations = new Map([['one', '/project'], ['two', '/project'], ['foreign', '/other']])
  const parents = new Map<string, string>()
  const failGet = new Set<string>()
  const getCalls: string[] = []
  const writes: unknown[] = []
  const emitted: { name: string; data: unknown }[] = []
  const removed: string[] = []
  const failRemove = new Set<string>()
  const calls: { directory: string; argv: readonly string[]; signal: AbortSignal }[] = []
  const prompts: { sessionID: string; delivery: string }[] = []
  const permissions: unknown[] = []
  let deny = false
  let handlers: Record<string, Handler> = {}
  let toolHook: Handler = async () => {}
  let promptHook: Handler = async () => {}
  let streamStopped = false
  let time = 0
  let sweep = async () => {}
  let branch = { ...VIEW, url: REF.url } as Record<string, unknown>
  let mutationGate: (() => Promise<void>) | undefined
  const events: { event: object; done: () => void }[] = []
  let wake: (() => void) | undefined
  const ctx = {
    location: { directory: '/project' },
    session: {
      hook: async (_name: string, hook: Handler) => { promptHook = hook },
      get: async ({ sessionID }: { sessionID: string }) => {
        getCalls.push(sessionID)
        if (failGet.has(sessionID)) throw new Error('temporary session.get failure')
        if (!locations.has(sessionID)) throw Object.assign(new Error('Missing session'), { _tag: 'SessionNotFoundError' })
        return { parentID: parents.get(sessionID), location: { directory: locations.get(sessionID) } }
      },
      prompt: async (input: { sessionID: string; delivery: string }) => { prompts.push(input) },
    },
    permission: { assert: async (input: unknown) => { permissions.push(input); if (deny) throw new Error('policy denied') } },
    storage: {
      get: async (key: string) => stored.get(key),
      set: async (key: string, value: unknown) => { writes.push(value); stored.set(key, structuredClone(value)) },
      remove: async (key: string) => { removed.push(key); if (failRemove.has(key)) throw new Error('storage unavailable'); stored.delete(key) },
    },
    rpc: { register: async (_definition: unknown, next: Record<string, Handler>) => {
      handlers = next
      return { events: { emit: async (name: string, data: unknown) => { emitted.push({ name, data }) } } }
    } },
    event: { subscribe: ({ signal }: { signal: AbortSignal }) => ({
      async *[Symbol.asyncIterator]() {
        try {
          while (!signal.aborted) {
            if (!events.length) await new Promise<void>(resolve => {
              const done = () => { signal.removeEventListener('abort', done); wake = undefined; resolve() }
              wake = done
              signal.addEventListener('abort', done, { once: true })
            })
            const next = events.shift()
            if (next) { yield next.event; next.done() }
          }
        } finally { streamStopped = true }
      },
    }) },
    tool: { hook: async (_name: string, hook: Handler) => { toolHook = hook } },
  }
  const cleanup = await setupPanel(ctx as unknown as Plugin.Context, (directory, signal) => async argv => {
    calls.push({ directory, argv, signal })
    if (argv[1] === 'pr' && argv[2] === 'merge' && mutationGate) await mutationGate()
    const stdout = argv.includes('-i') ? 'HTTP/2.0 200 OK\nEtag: "one"\n\n{}'
      : argv[2] === 'graphql' ? JSON.stringify(GRAPH)
      : argv.includes('url,state') ? JSON.stringify(branch)
      : JSON.stringify({ ...VIEW, url: REF.url })
    return { exitCode: 0, stdout, stderr: '' }
  }, { enabled, now: () => time, schedule: work => { sweep = work; return () => {} } })
  return {
    handlers, calls, prompts, permissions, stored, locations, parents, getCalls, failGet, writes, emitted, removed, failRemove,
    cleanup, sweep: () => sweep(), advance: (ms: number) => { time += ms }, setBranch: (next: Record<string, unknown>) => { branch = next },
    deny: () => { deny = true }, streamStopped: () => streamStopped, tool: (input: unknown) => toolHook(input), prompt: (input: unknown) => promptHook(input),
    emit: (event: object) => new Promise<void>(done => { events.push({ event, done }); wake?.() }),
    pauseMutation: () => {
      let enter!: () => void, release!: () => void
      const entered = new Promise<void>(resolve => { enter = resolve })
      const wait = new Promise<void>(resolve => { release = resolve })
      mutationGate = async () => { enter(); await wait }
      return { entered, release }
    },
  }
}

async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  assert.fail('Condition did not settle')
}

test('RPC sessions share one backend per session, not one per client', async () => {
  const f = await fake()
  try {
    await f.handlers.state({ sessionID: 'one' })
    const initial = f.calls.length
    await f.handlers.state({ sessionID: 'one' })
    assert.equal(f.calls.length, initial)
    await f.handlers.command({ sessionID: 'one', args: 'agent off' })
    const other = await f.handlers.state({ sessionID: 'two' }) as PanelState
    assert.equal(other.agent, true)
    assert.equal((await f.handlers.state({ sessionID: 'one' }) as PanelState).agent, false)
    assert.ok(f.calls.every(call => call.directory === '/project'))
  } finally { await f.cleanup() }
  assert.ok(f.streamStopped())
  assert.ok(f.calls.every(call => call.signal.aborted))
})

test('foreign sessions are rejected before any process executes', async () => {
  const f = await fake()
  try {
    await assert.rejects(f.handlers.state({ sessionID: 'foreign' }), /another location/)
    assert.equal(f.calls.length, 0)
  } finally { await f.cleanup() }
})

test('moving a session invalidates its old backend and aborts processes', async () => {
  const f = await fake()
  try {
    await f.handlers.state({ sessionID: 'one' })
    f.locations.set('one', '/other')
    await assert.rejects(f.handlers.state({ sessionID: 'one' }), /another location/)
    assert.ok(f.calls.every(call => call.signal.aborted))
  } finally { await f.cleanup() }
})

test('state is saved on updates and no model prompt is sent during discovery', async () => {
  const f = await fake()
  await f.handlers.state({ sessionID: 'one' })
  await f.handlers.command({ sessionID: 'one', args: 'agent off' })
  await f.cleanup()
  assert.equal((f.stored.get('session/one') as PanelState).agent, false)
  assert.equal(f.prompts.length, 0)
})

test('denied or failed tools never trigger PR discovery', async () => {
  const f = await fake()
  try {
    await f.tool({ status: 'error', tool: 'shell', sessionID: 'one', input: { command: 'gh pr create' } })
    assert.equal(f.calls.length, 0)
  } finally { await f.cleanup() }
})

test('confirmed actions still obey session shell permissions', async () => {
  const f = await fake()
  try {
    const prepared = await f.handlers.prepare({ sessionID: 'one', url: REF.url, action: 'bypass' }) as { token: string }
    assert.equal(f.permissions.length, 0)
    f.deny()
    await f.handlers.action({ sessionID: 'one', token: prepared.token })
    assert.equal(f.permissions.length, 1)
    assert.ok(!f.calls.some(call => call.argv[1] === 'pr' && call.argv[2] === 'merge'))
    const state = await f.handlers.state({ sessionID: 'one' }) as PanelState
    assert.match(state.notice!.text, /policy denied/)
    assert.equal(state.busy, null)
  } finally { await f.cleanup() }
})

test('Fix RPC forwards the explicit target instead of the shared selection', async () => {
  const f = await fake()
  try {
    const state = await f.handlers.state({ sessionID: 'one' }) as PanelState
    const thread = state.prs[0].snapshot!.threads[0]
    await f.handlers.command({ sessionID: 'one', args: 'https://github.com/acme/app/pull/43' })
    const result = await f.handlers.fix({ sessionID: 'one', target: { url: REF.url, kind: 'thread', itemID: thread.id } }) as { text: string }
    assert.ok(result.text.includes('#42'))
    assert.ok(result.text.includes(thread.body))
    assert.equal(f.prompts.length, 0)
  } finally { await f.cleanup() }
})

test('subagent prompts never discover PRs or create their own backend', async () => {
  const f = await fake()
  try {
    f.locations.set('child', '/project')
    f.parents.set('child', 'one')
    await f.prompt({ sessionID: 'child' })
    await until(() => f.getCalls.includes('child'))
    await assert.rejects(f.handlers.state({ sessionID: 'child' }), /root sessions/)
    assert.equal(f.calls.length, 0)
    assert.equal(f.prompts.length, 0)
    await f.tool({ status: 'completed', tool: 'shell', sessionID: 'child', input: { command: 'gh pr create' }, result: { content: REF.url } })
    await until(() => f.calls.length > 1)
    const state = await f.handlers.state({ sessionID: 'one' }) as PanelState
    assert.equal(state.prs[0].ref.url, REF.url)
    assert.ok(!f.stored.has('session/child'))
  } finally { await f.cleanup() }
})

test('one failed storage removal does not stop cleanup of later moved sessions', async () => {
  const f = await fake()
  const report = console.error
  const errors: unknown[] = []
  console.error = (...args) => { errors.push(args) }
  try {
    await f.handlers.state({ sessionID: 'one' })
    await f.handlers.state({ sessionID: 'two' })
    f.failRemove.add('session/one')
    await f.emit({ type: 'session.deleted', data: { sessionID: 'one' } })
    await f.emit({ type: 'session.moved', data: { sessionID: 'two' } })
    assert.ok(f.calls.every(call => call.signal.aborted))
    assert.ok(!f.streamStopped())
    assert.equal(errors.length, 1)
  } finally { console.error = report; await f.cleanup() }
})

test('undefined tool content safely falls back to branch discovery', async () => {
  const f = await fake()
  try {
    f.setBranch({})
    await f.handlers.state({ sessionID: 'one' })
    const before = f.calls.length
    f.setBranch({ url: REF.url, state: 'OPEN' })
    await f.tool({ status: 'completed', tool: 'shell', sessionID: 'one', input: { command: 'gh pr create' }, result: {} })
    await until(() => f.calls.length > before + 1)
    const state = await f.handlers.state({ sessionID: 'one' }) as PanelState
    assert.equal(state.prs[0].ref.url, REF.url)
  } finally { await f.cleanup() }
})

test('transient session.get failures cannot abort an in-flight confirmed mutation', async () => {
  const f = await fake()
  try {
    await f.handlers.state({ sessionID: 'one' })
    const prepared = await f.handlers.prepare({ sessionID: 'one', url: REF.url, action: 'bypass' }) as { token: string }
    const gate = f.pauseMutation()
    const action = f.handlers.action({ sessionID: 'one', token: prepared.token })
    await gate.entered
    f.failGet.add('one')
    try {
      await assert.rejects(f.handlers.state({ sessionID: 'one' }), /temporary/)
      assert.ok(f.calls.every(call => !call.signal.aborted))
    } finally { f.failGet.delete('one'); gate.release(); await action }
  } finally { await f.cleanup() }
})

test('a definitive missing-session response does clean up the backend', async () => {
  const f = await fake()
  try {
    await f.handlers.state({ sessionID: 'one' })
    f.locations.delete('one')
    await assert.rejects(f.handlers.state({ sessionID: 'one' }), /Missing session/)
    assert.ok(f.calls.every(call => call.signal.aborted))
  } finally { await f.cleanup() }
})

test('idle empty backends are evicted after persisting their session settings', async () => {
  const f = await fake()
  try {
    f.setBranch({})
    await f.handlers.state({ sessionID: 'one' })
    await f.handlers.command({ sessionID: 'one', args: 'agent off' })
    const oldSignal = f.calls[0].signal
    f.advance(60_001)
    await f.sweep()
    assert.ok(oldSignal.aborted)
    const restored = await f.handlers.state({ sessionID: 'one' }) as PanelState
    assert.equal(restored.agent, false)
    assert.ok(!f.calls.at(-1)!.signal.aborted)
  } finally { await f.cleanup() }
})

test('poll ticks do not query every session and state changes are coalesced', async () => {
  const f = await fake()
  await f.handlers.state({ sessionID: 'one' })
  const reads = f.getCalls.length
  await f.sweep()
  await f.sweep()
  assert.equal(f.getCalls.length, reads)
  await f.handlers.command({ sessionID: 'one', args: 'agent off' })
  await f.handlers.command({ sessionID: 'one', args: 'agent on' })
  await f.handlers.command({ sessionID: 'one', args: 'agent off' })
  await f.cleanup()
  assert.equal(f.writes.length, 1)
  const updates = f.emitted.filter(event => event.name === 'updated')
  assert.equal(updates.length, 1)
  assert.equal((updates[0].data as { state: PanelState }).state.agent, false)
})

test('disabled server advertises its capability without starting pollers', async () => {
  const f = await fake(false)
  try {
    assert.deepEqual(await f.handlers.status({}), { enabled: false })
    await assert.rejects(f.handlers.state({ sessionID: 'one' }), /disabled/)
    assert.equal(f.calls.length, 0)
    assert.equal(f.getCalls.length, 0)
  } finally { await f.cleanup() }
})
