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
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))

  // The session starts as a session does: its figures and commands read in the background.
  await $.session.start({ cwd: '/home/me/src/app', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'hud', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  expect(ran.text).toBe('Session HUD opened.')
  for (let i = 0; i < 100; i++) await Promise.resolve()

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
