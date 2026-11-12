import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const VIEWPORT = { columns: 160, rows: 60 }
const PANE_PROPS = {
  title: 'hud',
  isFocused: false,
  bodyColumns: 44,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 50 },
  view: {},
}
const ok = (stdout: string) => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})
const dir = (name: string) => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })
const file = (name: string) => ({ name, kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false })

test('/hud draws context, usage, status and grouped commands; a press puts the command in the prompt', async ($, on) => {
  const filled: string[] = []
  let clock = 1_000_000
  on('clock.now', () => ({ value: clock }))
  on('session.cwd', () => ({ value: '/home/me/src/app' }))
  on('session.root', () => ({ value: '/home/me/src/app' }))
  on('session.id', () => ({ value: 'abcdef0123456789' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.repo', () => ({ value: { root: '/home/me/src/app', remote: null, internal: false, name: 'acme/app' } }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('process.run', () => ok('feature/hud\n'))
  on('session.usage', () => ({
    value: {
      startedAt: 1_000_000,
      context: { tokens: 120_000, window: 200_000, percent: 60 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 92 }],
      cost: { usd: 1.5 },
    },
  }))
  on('command.list', () => ({
    value: [
      { name: 'deploy', description: 'Deploy the app', source: 'user' as const },
      { name: 'standup', description: 'Write my standup', source: 'user' as const },
      { name: 'ship', description: 'Ship it', source: 'plugin' as const, plugin: 'ship' },
      { name: 'compact', description: 'Compact the conversation', source: 'builtin' as const },
    ],
  }))
  on('fs.list', (_, e) => ({
    value:
      e.path === '/home/me/src/app/.claude/skills'
        ? [dir('deploy')]
        : e.path === '/home/me/.claude/commands'
          ? [file('standup.md')]
          : [],
  }))
  on('prompt.read', () => ({ value: { text: 'to staging', cursor: 10 } }))
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('clock.every', () => ({ value: undefined }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  // An earlier session pinned a command this session no longer has, and opened Built-in.
  const store = new Map<string, unknown>([
    ['pins', ['gone']],
    ['open', { builtin: true }],
  ])
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.delete', (_, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))

  // The session starts as a session does: its figures and commands read in the background.
  await $.session.start({ cwd: '/home/me/src/app', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'hud', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  expect(ran.text).toBe('Session HUD opened.')
  for (let i = 0; i < 2000; i++) await Promise.resolve()

  await $.turn.start({ text: 'add the hud', turnId: 't1' })
  clock = 1_065_000

  for (const surface of ['terminal', 'desktop'] as const) {
    filled.length = 0
    const pane = await $.ui.mount({
      plugin: 'session-hud',
      surface,
      component: 'Pane',
      props: PANE_PROPS,
      requestId: 'session-hud',
      viewport: VIEWPORT,
    })
    expect(await pane.find({ type: 'Text', text: /^~\/src\/app$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^acme\/app$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^feature\/hud$/ })).toBeDefined()
    // Within the plan's limits the cost is hidden.
    expect(await pane.find({ type: 'Text', text: /\$1\.50/ })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: /^abcdef01 · up / })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Working 1m05s/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /add the hud/ })).toBeDefined()

    // The project's skill and the user's command land in their own groups; Built-in is open as the store kept it.
    expect(await pane.find({ key: 'cmd-project-deploy' })).toBeDefined()
    expect(await pane.find({ key: 'cmd-user-standup' })).toBeDefined()
    expect(await pane.find({ key: 'cmd-builtin-compact' })).toBeDefined()
    // Plugins start folded, and open to a sub-group a plugin, itself folded.
    expect(await pane.find({ key: 'toggle-plugin-ship' })).toBeUndefined()
    await pane.press({ key: 'toggle-plugin' })
    expect(await pane.find({ key: 'toggle-plugin-ship' })).toMatchObject({ text: expect.stringMatching(/ship \(1\)/) })
    expect(await pane.find({ key: 'cmd-plugin-ship' })).toBeUndefined()
    await pane.press({ key: 'toggle-plugin-ship' })
    expect(await pane.find({ key: 'cmd-plugin-ship' })).toBeDefined()
    expect(store.get('open')).toEqual({ builtin: true, plugin: true, 'plugin:ship': true })
    await pane.press({ key: 'toggle-plugin-ship' })
    await pane.press({ key: 'toggle-plugin' })
    expect(store.get('open')).toEqual({ builtin: true, plugin: false, 'plugin:ship': false })

    // A description is hidden behind ?> until pressed; one is open at a time, and a second press closes it.
    expect(await pane.find({ key: 'desc-project-deploy' })).toMatchObject({ text: '?>' })
    expect(await pane.find({ type: 'Text', text: 'Deploy the app' })).toBeUndefined()
    await pane.press({ key: 'desc-project-deploy' })
    expect(await pane.find({ type: 'Text', text: 'Deploy the app' })).toBeDefined()
    expect(await pane.find({ key: 'desc-project-deploy' })).toMatchObject({ text: '?v' })
    await pane.press({ key: 'desc-user-standup' })
    expect(await pane.find({ type: 'Text', text: 'Deploy the app' })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: 'Write my standup' })).toBeDefined()
    // The open description closes from its own text too.
    await pane.press({ key: 'text-user-standup' })
    expect(await pane.find({ type: 'Text', text: 'Write my standup' })).toBeUndefined()
    expect(filled).toEqual([])

    await pane.press({ key: 'cmd-project-deploy' })
    expect(filled).toEqual(['/deploy to staging'])
    await pane.unmount()
  }

  // Pins: a star puts a command in Pinned at the top, in the order pinned, and the store keeps them.
  const pinned = await $.ui.mount({ plugin: 'session-hud', surface: 'terminal', component: 'Pane', props: PANE_PROPS, requestId: 'session-hud', viewport: VIEWPORT })
  expect(await pinned.find({ key: 'toggle-pinned' })).toBeUndefined()
  await pinned.press({ key: 'pin-user-standup' })
  await pinned.press({ key: 'pin-project-deploy' })
  expect(store.get('pins')).toEqual(['gone', 'standup', 'deploy'])
  expect(await pinned.find({ key: 'toggle-pinned' })).toMatchObject({ text: expect.stringMatching(/Pinned \(2\)/) })
  expect(await pinned.find({ key: 'pin-pinned-deploy' })).toMatchObject({ text: '★' })
  // Pinned rows act as any other: the name fills the prompt.
  filled.length = 0
  await pinned.press({ key: 'cmd-pinned-standup' })
  expect(filled).toEqual(['/standup to staging'])
  // Unpinned from the Pinned group or from its own: either star does it.
  await pinned.press({ key: 'pin-pinned-standup' })
  await pinned.press({ key: 'pin-project-deploy' })
  expect(store.get('pins')).toEqual(['gone'])
  expect(await pinned.find({ key: 'toggle-pinned' })).toBeUndefined()
  await pinned.unmount()

  // The turn ends: the status turns idle and says how long the turn ran.
  await $.turn.complete({ turnId: 't1', answer: 'Done.', durationMs: 65_000, isAborted: false, reason: 'answer' })
  clock = 1_125_000
  await $.turn.start({ text: 'ignored', turnId: 's1', agentId: 'sub-1' })
  const pane = await $.ui.mount({ plugin: 'session-hud', surface: 'terminal', component: 'Pane', props: PANE_PROPS, requestId: 'session-hud', viewport: VIEWPORT })
  expect(await pane.find({ type: 'Text', text: /Idle/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /last turn 1m05s/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /\$2\.25/ })).toBeUndefined()
  await pane.unmount()

  // Past the 5-hour window the session draws on extra usage: now the cost shows.
  await $.session.measure({
    context: { tokens: 130_000, window: 200_000, percent: 65 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 100.5 }],
    cost: { usd: 2.25 },
    changed: ['rateLimits'],
  })
  const over = await $.ui.mount({ plugin: 'session-hud', surface: 'terminal', component: 'Pane', props: PANE_PROPS, requestId: 'session-hud', viewport: VIEWPORT })
  expect(await over.find({ type: 'Text', text: /^\$2\.25$/ })).toBeDefined()
  await over.unmount()
})

/** Lets the work a hook left running settle. */
const settle = async () => {
  for (let i = 0; i < 2000; i++) await Promise.resolve()
}

const MOUNT = { plugin: 'session-hud', surface: 'terminal' as const, component: 'Pane' as const, props: PANE_PROPS, requestId: 'session-hud', viewport: VIEWPORT }

type Agent = { id: string; kind: string; sessionId: string; name: string; status: string; state: string; startedAt: number }

const agent = (id: string, name: string, state: string, startedAt = 900_000): Agent => ({
  id,
  kind: 'background',
  sessionId: `${id}-full`,
  name,
  status: state === 'working' ? 'busy' : 'idle',
  state,
  startedAt,
})

/**
 * Stubs the engine for the sessions tests: session `s-main` in /home/me/src/app,
 * the store in memory, `claude agents` answering `world.agents`, the lineage
 * check answering for the sessions with a transcript (`world.transcripts`) by
 * `world.related`, and the activity read giving each transcript's lines.
 * Counts what the plugin asked: the lineage and activity reads, the panes opened.
 */
const stubEngine = (
  on: On,
  world: {
    agents: Agent[]
    related: string[]
    transcripts: Record<string, string[]>
    clock: number
    /** Set: every store read fails. */
    isStoreDown?: boolean
    /** Set: `claude agents` answers only once it resolves. */
    gate?: Promise<void>
    /** The slash commands the session lists. */
    commands?: { name: string; description: string; source: 'user' }[]
  },
  initial: Record<string, unknown> = {},
) => {
  const store = new Map<string, unknown>(Object.entries(initial))
  const asked = { lineage: [] as string[][], activity: [] as string[][], opened: [] as string[], agentsReads: 0 }
  let panes: { id: string; title: string; isShown: boolean; isFocused: boolean; isPlaced: boolean }[] = []
  on('session.id', () => ({ value: 's-main' }))
  on('session.cwd', () => ({ value: '/home/me/src/app' }))
  on('session.root', () => ({ value: '/home/me/src/app' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.repo', () => ({ value: null }))
  on('session.usage', () => ({ value: { startedAt: 1_000_000, context: { window: 200_000 }, rateLimits: [] } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('store.get', (_, e) => {
    if (world.isStoreDown) throw new Error('store unavailable')
    return { value: store.get(e.key) }
  })
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('command.list', () => ({ value: world.commands ?? [] }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('command.run', { command: 'fork' }, () => ({}))
  on('fs.list', () => ({ value: [] }))
  on('clock.now', () => ({ value: world.clock }))
  // Answered, the timers fire: the tick and the restore run beside what each test does.
  on('clock.every', () => ({ value: undefined }))
  on('clock.sleep', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: panes }))
  on('ui.open', (_, e) => {
    asked.opened.push(e.id)
    panes = [{ id: e.id, title: e.title ?? '', isShown: true, isFocused: false, isPlaced: true }]
    return { value: { isPlaced: true } }
  })
  on('process.run', async (_, e) => {
    const [command, , script = ''] = e.argv
    if (command === 'claude') {
      asked.agentsReads++
      await world.gate
      return ok(JSON.stringify(world.agents))
    }
    if (command === 'sh' && script.includes('mine=')) {
      const candidates = e.argv.slice(6)
      asked.lineage.push(candidates)
      const known = candidates.filter(id => Object.hasOwn(world.transcripts, id))
      return ok(known.map(id => `${world.related.includes(id) ? '+' : '-'}${id}\n`).join(''))
    }
    if (command === 'sh' && script.includes('tail -c')) {
      const ids = e.argv.slice(5)
      asked.activity.push(ids)
      return ok(ids.flatMap(id => [`@@@ ${id}`, ...(world.transcripts[id] ?? [])]).join('\n'))
    }
    return ok('main\n')
  })
  return { store, asked }
}

const at = (ms: number) => new Date(ms).toISOString()
const prompted = (text: string) => JSON.stringify({ type: 'last-prompt', lastPrompt: text })
const said = (ms: number, text: string) => JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text }] }, timestamp: at(ms) })
const ran = (ms: number, command: string, description: string) =>
  JSON.stringify({ message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command, description } }] }, timestamp: at(ms) })
const turnEnded = (ms: number) => JSON.stringify({ type: 'system', subtype: 'turn_duration', timestamp: at(ms) })

test('/fork lists the fork it started, with what it does; unrelated sessions are not listed', async ($, on) => {
  const world = {
    clock: 1_000_000,
    agents: [agent('zz', 'unrelated', 'done'), { ...agent('me', 'this one', 'working'), kind: 'interactive', sessionId: 's-main' }],
    related: ['f1-full'],
    transcripts: { 'zz-full': [] as string[] } as Record<string, string[]>,
  }
  stubEngine(on, world)
  await $.session.start({ cwd: '/home/me/src/app', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'hud', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  await settle()
  let pane = await $.ui.mount(MOUNT)
  expect(await pane.find({ type: 'Text', text: /Other sessions of this conversation/ })).toBeUndefined()
  await pane.unmount()

  // /fork: the new background session, working, shows its turn's time, its tool and its prompt.
  world.agents = [...world.agents, agent('f1', 'main ⑂ try the fix', 'working', 1_000_100)]
  world.transcripts['f1-full'] = [turnEnded(950_000), prompted('try the other fix'), ran(960_000, 'npm test', 'Run the tests')]
  await $.command.run({ command: 'fork', args: 'try the fix', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  await settle()
  pane = await $.ui.mount(MOUNT)
  expect(await pane.find({ key: 'conv-f1-full' })).toMatchObject({
    text: expect.stringMatching(/● main ⑂ try the fix.*working 40s · ⑂ fork f1.*↳ Bash Run the tests.*“try the other fix”/s),
  })
  expect(await pane.find({ key: 'conv-zz-full' })).toBeUndefined()
  await pane.unmount()
})

test('forks are found again on /hud and ↻, each checked once; done ones are not read again; gone ones leave', async ($, on) => {
  const world = {
    clock: 1_000_000,
    agents: [agent('f1', 'main ⑂ first', 'done'), agent('zz', 'unrelated', 'done')],
    related: ['f1-full', 'f2-full'],
    transcripts: { 'f1-full': [prompted('first'), said(970_000, 'Done.'), turnEnded(970_000)], 'zz-full': [] } as Record<string, string[]>,
  }
  const { asked } = stubEngine(on, world)
  // A new process (a restart): the forks still running are found when the HUD opens.
  await $.session.start({ cwd: '/home/me/src/app', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'hud', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  await settle()
  const pane = await $.ui.mount(MOUNT)
  expect(await pane.find({ key: 'conv-f1-full' })).toMatchObject({ text: expect.stringMatching(/✓ main ⑂ first.*done 30s ago.*“first”/s) })
  expect(await pane.find({ key: 'conv-zz-full' })).toBeUndefined()

  // A fork made elsewhere, its transcript not written yet: not listed, and asked about again on ↻.
  world.agents = [...world.agents, agent('f2', 'main ⑂ second', 'working', 990_000)]
  await pane.press({ key: 'refresh-status' })
  expect(await pane.find({ key: 'conv-f2-full' })).toBeUndefined()
  world.transcripts['f2-full'] = [turnEnded(980_000), prompted('second'), ran(990_000, 'ls', 'List files')]
  await pane.press({ key: 'refresh-status' })
  expect(await pane.find({ key: 'conv-f2-full' })).toMatchObject({ text: expect.stringMatching(/main ⑂ second.*working 10s.*↳ Bash List files/s) })

  // Whether a session is a fork was asked once for each with a transcript; a done fork's transcript was read once.
  expect(asked.lineage.flat().filter(id => id === 'zz-full')).toHaveLength(1)
  expect(asked.lineage.flat().filter(id => id === 'f1-full')).toHaveLength(1)
  expect(asked.activity.flat().filter(id => id === 'f1-full')).toHaveLength(1)

  // A fork read while working is read again once it is done: its row dates from its turn's end.
  world.clock = 1_060_000
  world.agents = world.agents.map(one => (one.id === 'f2' ? { ...one, status: 'idle', state: 'done' } : one))
  world.transcripts['f2-full'] = [...world.transcripts['f2-full']!, said(1_050_000, 'Listed.'), turnEnded(1_050_000)]
  await pane.press({ key: 'refresh-status' })
  expect(await pane.find({ key: 'conv-f2-full' })).toMatchObject({ text: expect.stringMatching(/✓ main ⑂ second.*done 10s ago/s) })
  // Read as done, it is not read again.
  const readsOfDone = asked.activity.flat().filter(id => id === 'f2-full').length
  await pane.press({ key: 'refresh-status' })
  expect(asked.activity.flat().filter(id => id === 'f2-full')).toHaveLength(readsOfDone)

  // Attached and prompted again, it works again: read again, with its new turn.
  world.clock = 1_100_000
  world.agents = world.agents.map(one => (one.id === 'f2' ? { ...one, status: 'busy', state: 'working' } : one))
  world.transcripts['f2-full'] = [...world.transcripts['f2-full']!, prompted('again'), ran(1_090_000, 'npm test', 'Run the tests')]
  await pane.press({ key: 'refresh-status' })
  expect(await pane.find({ key: 'conv-f2-full' })).toMatchObject({ text: expect.stringMatching(/working 10s.*↳ Bash Run the tests.*“again”/s) })

  // A fork that no longer runs leaves the list.
  world.agents = world.agents.filter(one => one.id !== 'f1')
  await pane.press({ key: 'refresh-status' })
  expect(await pane.find({ key: 'conv-f1-full' })).toBeUndefined()
  expect(await pane.find({ key: 'conv-f2-full' })).toBeDefined()

  // When `claude agents` cannot be read, the forks say so rather than show their last state.
  world.agents = 'not json' as unknown as Agent[]
  await pane.press({ key: 'refresh-status' })
  expect(await pane.find({ key: 'conv-f2-full' })).toMatchObject({ text: expect.stringMatching(/○ session f2-full.*not read yet/s) })
  await pane.unmount()
})

test('/hud records its pane as open for this session, keeping the other sessions\' records', async ($, on) => {
  const world = { clock: 1_000_000, agents: [], related: [], transcripts: {} }
  const { store } = stubEngine(on, world, { openPanes: { 'other-session': true } })
  await $.session.start({ cwd: '/home/me/src/app', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'hud', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  await settle()
  expect(store.get('openPanes')).toEqual({ 'other-session': true, 's-main': true })
})

for (const [kept, isOpened] of [
  [{ 's-main': true }, true],
  [{ 'other-session': false }, true],
  [undefined, true],
  [{ 's-main': false }, false],
] as const)
  test(`a session starting with ${JSON.stringify(kept)} stored ${isOpened ? 'opens the HUD by itself' : 'leaves the HUD the person closed closed'}`, async ($, on) => {
    const world = { clock: 1_000_000, agents: [], related: [], transcripts: {} }
    const { asked } = stubEngine(on, world, kept ? { openPanes: kept } : {})
    await $.session.start({ cwd: '/home/me/src/app', surface: 'terminal', isInteractive: true })
    await settle()
    // Once, though the start and the restore timer both look.
    expect(asked.opened).toEqual(isOpened ? ['session-hud'] : [])
  })

test('a store that cannot be read opens nothing', async ($, on) => {
  const world = { clock: 1_000_000, agents: [], related: [], transcripts: {}, isStoreDown: true }
  const { asked } = stubEngine(on, world)
  await $.session.start({ cwd: '/home/me/src/app', surface: 'terminal', isInteractive: true })
  await settle()
  expect(asked.opened).toEqual([])
})

test('a failed store read writes nothing: the stored pins and open panes stay, and the pin lasts this session', async ($, on) => {
  const world = {
    clock: 1_000_000,
    agents: [],
    related: [],
    transcripts: {},
    isStoreDown: false,
    commands: [{ name: 'standup', description: 'Write my standup', source: 'user' as const }],
  }
  const { store } = stubEngine(on, world, { pins: ['keep'], openPanes: { 'other-session': true } })
  await $.session.start({ cwd: '/home/me/src/app', surface: 'terminal', isInteractive: true })
  await settle()
  world.isStoreDown = true
  await $.command.run({ command: 'hud', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  await settle()
  const pane = await $.ui.mount(MOUNT)
  await pane.press({ key: 'pin-user-standup' })
  expect(store.get('pins')).toEqual(['keep'])
  expect(store.get('openPanes')).toEqual({ 'other-session': true })
  expect(await pane.find({ key: 'pin-pinned-standup' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Could not save the pins/ })).toBeDefined()
  await pane.unmount()
})

test('a refresh asked for while a read runs makes exactly one more read, which lists the new fork', async ($, on) => {
  let open = () => {}
  const world = {
    clock: 1_000_000,
    agents: [] as Agent[],
    related: ['f1-full'],
    transcripts: { 'f1-full': [turnEnded(950_000), prompted('first')] } as Record<string, string[]>,
    gate: new Promise<void>(resolve => (open = resolve)) as Promise<void> | undefined,
  }
  const { asked } = stubEngine(on, world)
  await $.session.start({ cwd: '/home/me/src/app', surface: 'terminal', isInteractive: true })
  // /fork: its read starts and waits on `claude agents`.
  await $.command.run({ command: 'fork', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  await settle()
  const before = asked.agentsReads
  expect(before).toBe(1)
  // The fork registers after that read began; another /fork asks while it runs.
  world.agents = [agent('f1', 'main ⑂ first', 'idle')]
  await $.command.run({ command: 'fork', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  await settle()
  expect(asked.agentsReads).toBe(before)
  world.gate = undefined
  open()
  await settle()
  expect(asked.agentsReads).toBe(before + 1)
  const pane = await $.ui.mount(MOUNT)
  expect(await pane.find({ key: 'conv-f1-full' })).toBeDefined()
  await pane.unmount()
})
