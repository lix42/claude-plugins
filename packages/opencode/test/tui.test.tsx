import { test } from 'node:test'
import assert from 'node:assert/strict'
import { testRender } from '@opentui/solid'
import { createRoot } from 'solid-js'
import type { Plugin } from '@opencode/plugin/tui'
import type { KeymapLayer, SlotClaim } from '@opencode/plugin/tui/context'
import plugin from '../dist/tui.js'
import { checkID, initialState, type FixTarget } from '../src/rpc.ts'
import { parseSnapshot } from '../../../plugins/pr-panel/hooks/parse'
import { GRAPH, REF, VIEW } from '../../../plugins/pr-panel/tests/fixtures'

async function fake(config: { serverEnabled?: boolean; mounted?: boolean; failStatus?: boolean } = {}) {
  const claims: SlotClaim[] = []
  const layers: (() => KeymapLayer)[] = []
  const state = { ...initialState(), selected: REF.url, prs: [{ ref: REF, snapshot: parseSnapshot({ ...VIEW, mergeStateStatus: 'CLEAN' }, GRAPH), error: null, fetchedAt: 0, endedAt: null }] }
  const calls: string[] = []
  const fixRequests: { sessionID: string; target: FixTarget }[] = []
  const requests: { name: string; input: unknown }[] = []
  const listeners = new Map<string, (event: { data: unknown }) => Promise<void> | void>()
  const toasts: unknown[] = [], notifications: unknown[] = []
  let duringChoose = () => {}
  let chooseKind: FixTarget['kind'] = 'thread'
  let confirm = false
  const rpc = {
    status: async () => { calls.push('status'); if (config.failStatus) throw new Error('RPC unavailable'); return { enabled: config.serverEnabled !== false } },
    state: async () => { calls.push('state'); return state },
    command: async (input: unknown) => { requests.push({ name: 'command', input }); return { text: 'done' } },
    method: async (input: unknown) => { requests.push({ name: 'method', input }); return {} },
    refresh: async (input: unknown) => { requests.push({ name: 'refresh', input }); return {} },
    prepare: async (input: unknown) => { calls.push('prepare'); requests.push({ name: 'prepare', input }); return { token: 'token', label: 'Merge #42', url: REF.url, sha: 'abc123' } },
    action: async () => { calls.push('action'); return {} },
    fix: async (input: { sessionID: string; target: FixTarget }) => { calls.push('fix'); fixRequests.push(input); return { text: 'Original Fix prompt' } },
    events: { on: (name: string, callback: (event: { data: unknown }) => Promise<void> | void) => { listeners.set(name, callback); return () => listeners.delete(name) } },
  }
  const ctx = {
    options: {},
    client: { rpc: () => rpc, session: { prompt: async (input: { text: string; delivery: string }) => { calls.push(`sent:${input.delivery}:${input.text}`) } } },
    data: { session: { get: () => ({ location: { directory: '/project' } }) } },
    theme: { text: { base: '#ffffff', accent: '#88aaff', muted: '#aaaaaa' } },
    keymap: { layer: (factory: () => KeymapLayer) => { layers.push(factory) } },
    attention: { notify: async (input: unknown) => { notifications.push(input) } },
    ui: {
      slot: (claim: SlotClaim) => { claims.push(claim); return () => {} },
      router: { current: () => ({ type: 'session', sessionID: 'one' }) },
      panel: { open: () => true },
      toast: { show: (input: unknown) => { toasts.push(input) } },
      dialog: {
        select: async ({ options }: { options: { value: FixTarget | string }[] }) => {
          const chosen = typeof options[0]?.value === 'string' ? 'rebase' : options.find(option => typeof option.value !== 'string' && option.value.kind === chooseKind)?.value
          duringChoose()
          return chosen
        },
        prompt: async () => 'Edited Fix prompt',
        confirm: async () => { calls.push('confirm'); return confirm },
      },
    },
  }
  let cleanup: (() => void | Promise<void>) | void
  let dispose = () => {}
  createRoot(stop => { dispose = stop; cleanup = plugin.setup(ctx as unknown as Plugin.Context) as () => void })
  const band = claims.find(claim => claim.append === 'session.composer.top')! as SlotClaim<'session.composer.top'>
  const panel = claims.find(claim => claim.append === 'session.panel')! as SlotClaim<'session.panel'>
  const panelProps = { name: 'lix42.pr-panel', sessionID: 'one', width: 110, presentation: 'panel' as const, focused: true, close: () => {}, focus: () => {}, toggleFullscreen: () => {} }
  const rendered = await testRender(() => <box flexDirection="column" height="100%">
    {config.mounted !== false && band.render({ sessionID: 'one' })}
    {config.mounted !== false && panel.render(panelProps)}
  </box>, { width: 110, height: 50 })
  if (config.mounted !== false && config.serverEnabled !== false && !config.failStatus) await rendered.waitForFrame(frame => frame.includes('Add the thing'))
  return {
    ...rendered, calls, state, fixRequests, requests, toasts, notifications, panelProps,
    emit: (name: string, data: unknown) => listeners.get(name)?.({ data }),
    panelLayer: () => layers.map(factory => factory()).find(layer => layer.commands?.some(command => command.bind === 'r'))!,
    nativeCommand: () => layers.flatMap(factory => factory().commands ?? []).find(command => command.id === 'lix42.pr')!,
    duringChoose: (fn: () => void) => { duringChoose = fn },
    chooseKind: (kind: FixTarget['kind']) => { chooseKind = kind },
    command: (bind: string) => layers.flatMap(factory => factory().commands ?? []).find(command => command.bind === bind)!,
    setConfirm: (value: boolean) => { confirm = value },
    cleanup: async () => { rendered.renderer.destroy(); await cleanup?.(); dispose() },
  }
}

test('TUI renders PR state, checks, reviews, threads, and a summary', async () => {
  const f = await fake()
  try {
    const frame = f.captureCharFrame()
    for (const text of ['#42', 'Add the thing', 'Checks', 'lint', 'Latest reviews', 'Unresolved threads', 'Handle null here', 'Recent comments']) assert.ok(frame.includes(text), text)
  } finally { await f.cleanup() }
})

test('TUI merge action runs only after an explicit confirmation', async () => {
  const f = await fake()
  try {
    f.command('m').run()
    await f.waitFor(() => f.calls.includes('confirm'))
    assert.ok(!f.calls.includes('action'))
    f.setConfirm(true)
    f.command('m').run()
    await f.waitFor(() => f.calls.includes('action'))
  } finally { await f.cleanup() }
})

test('Fix preview can be cancelled and sends edited text only on Send', async () => {
  const f = await fake()
  try {
    f.command('f').run()
    await f.waitFor(() => f.calls.includes('confirm'))
    assert.ok(!f.calls.some(call => call.startsWith('sent:')))
    f.setConfirm(true)
    f.command('f').run()
    await f.waitFor(() => f.calls.some(call => call.startsWith('sent:')))
    assert.ok(f.calls.includes('sent:queue:Edited Fix prompt'))
  } finally { await f.cleanup() }
})

test('Fix chooser sends the displayed thread identity even if shared selection changes', async () => {
  const f = await fake()
  try {
    const original = f.state.prs[0].snapshot.threads[0]
    f.duringChoose(() => {
      f.state.prs[0].snapshot.threads = []
      f.state.selected = 'https://github.com/acme/app/pull/43'
      f.state.prs.push({ ...f.state.prs[0], ref: { ...REF, url: f.state.selected, number: 43 } })
    })
    f.command('f').run()
    await f.waitFor(() => f.fixRequests.length === 1)
    assert.deepEqual(f.fixRequests[0], { sessionID: 'one', target: { url: REF.url, kind: 'thread', itemID: original.id } })
  } finally { await f.cleanup() }
})

test('Fix chooser binds checks to their displayed identity and commit', async () => {
  const f = await fake()
  try {
    f.chooseKind('check')
    const snapshot = f.state.prs[0].snapshot
    const itemID = checkID(snapshot.checks[0])
    const headSha = snapshot.headSha
    f.duringChoose(() => { snapshot.checks.reverse(); snapshot.headSha = 'new-head' })
    f.command('f').run()
    await f.waitFor(() => f.fixRequests.length === 1)
    assert.deepEqual(f.fixRequests[0], { sessionID: 'one', target: { url: REF.url, kind: 'check', itemID, headSha } })
  } finally { await f.cleanup() }
})

test('important notices are delivered even when no session band or panel is mounted', async () => {
  const f = await fake({ mounted: false })
  try {
    await f.emit('notice', { sessionID: 'background', text: 'checks failed', title: 'PR #42', important: true })
    assert.equal(f.toasts.length, 1)
    assert.equal(f.notifications.length, 1)
  } finally { await f.cleanup() }
})

test('disabled or unavailable server capabilities cause no background error toasts', async () => {
  for (const config of [{ serverEnabled: false }, { failStatus: true }]) {
    const f = await fake(config)
    try {
      await f.waitFor(() => f.calls.includes('status'))
      await f.renderOnce()
      assert.equal(f.toasts.length, 0)
      assert.ok(!f.calls.includes('state'))
      if (config.serverEnabled === false) assert.equal((f.nativeCommand().enabled as () => boolean)(), false)
    } finally { await f.cleanup() }
  }
})

test('panel single-key bindings have an explicit focus gate', async () => {
  const f = await fake()
  try {
    assert.equal((f.panelLayer().enabled as () => boolean)(), true)
    f.panelProps.focused = false
    assert.equal((f.panelLayer().enabled as () => boolean)(), false)
  } finally { await f.cleanup() }
})

test('updated events render their snapshot without another full-state RPC read', async () => {
  const f = await fake()
  try {
    const before = f.calls.filter(call => call === 'state').length
    const state = structuredClone(f.state)
    state.prs[0].snapshot.title = 'Updated through event'
    await f.emit('updated', { sessionID: 'one', state })
    await f.waitForFrame(frame => frame.includes('Updated through event'))
    assert.equal(f.calls.filter(call => call === 'state').length, before)
  } finally { await f.cleanup() }
})

test('untrack and method choices send their displayed PR URL', async () => {
  const f = await fake()
  try {
    f.command('u').run()
    await f.waitFor(() => f.requests.length > 0)
    assert.deepEqual(f.requests[0], { name: 'command', input: { sessionID: 'one', args: 'untrack', url: REF.url } })
    f.duringChoose(() => { f.state.selected = 'https://github.com/acme/app/pull/43' })
    f.command('s').run()
    await f.waitFor(() => f.requests.some(request => request.name === 'method'))
    assert.deepEqual(f.requests.find(request => request.name === 'method')!.input, { sessionID: 'one', url: REF.url, method: 'rebase' })
  } finally { await f.cleanup() }
})
