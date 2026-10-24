import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const VIEWPORT = { columns: 160, rows: 40 }
const PANE_PROPS = {
  title: 'Session',
  isFocused: false,
  bodyColumns: 35,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}
const LONG = 'I traced the failure to a stale cache in the build step and cleared it. '.repeat(4)

const use = (tool: string, input: Record<string, unknown>) => ({ tool_use_id: `t-${tool}`, tool, input })
const ROWS = [
  { role: 'user' as const, text: 'why is CI red?', toolUses: [] },
  { role: 'assistant' as const, text: LONG, toolUses: [use('Bash', { command: 'gh run view' }), use('Bash', {})] },
  { role: 'user' as const, text: '<command-name>/code-review</command-name><command-args>high</command-args>', toolUses: [] },
  { role: 'assistant' as const, text: 'No findings.', toolUses: [use('Skill', { skill: 'code-review' })] },
]
const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

/** The plugin's store, kept in memory for one test. */
const memoryStore = (on: On) => {
  const values = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: values.get(e.key) }))
  on('store.set', (_, e) => {
    values.set(e.key, e.value)
    return { value: undefined }
  })
  return values
}

const ok = (stdout: string) => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

test('/compass resync draws the history, summarizes long text, and a prompt offers rewind or copy', async ($, on) => {
  const summarized: string[] = []
  const filled: string[] = []
  const commands: string[] = []
  on('session.messages', () => ({ value: ROWS }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.root', () => ({ value: '/src/app' }))
  on('session.repo', () => ({ value: { root: '/src/app', remote: null, internal: false, name: 'acme/app' } }))
  on('process.run', (_, e) => (e.argv[0] === 'git' ? ok('main\n') : ok('"aiTitle":"CI triage"\n')))
  on('model.complete', (_, e) => {
    summarized.push(String(e.prompt))
    return { value: { isAnswered: true, text: 'Cleared a stale build cache.', usage: USAGE } }
  })
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  on('command.run', { command: 'rewind' }, (_, e) => {
    commands.push(e.command)
    return {}
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.now', () => ({ value: 1_000_000 }))
  on('clock.sleep', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [{ id: 'session-compass', title: 'Session', isShown: true, isFocused: false, isPlaced: true }] }))

  const ran = await $.command.run({
    command: 'compass',
    args: 'resync',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  expect(ran.text).toBe('Session compass history rebuilt from the transcript.')
  // The summaries are asked for in the background, after the command answered.
  for (let i = 0; i < 50 && summarized.length === 0; i++) await Promise.resolve()
  for (let i = 0; i < 50; i++) await Promise.resolve()

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({
      plugin: 'session-compass',
      surface,
      component: 'Pane',
      props: PANE_PROPS,
      requestId: 'session-compass',
      viewport: VIEWPORT,
    })
    expect(await pane.find({ type: 'Text', text: /Cleared a stale build cache\./ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Bash×2/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /◆ code-review/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /\/code-review high/ })).toBeDefined()

    // A press on a prompt offers the two ways back; Cancel hides them.
    expect(await pane.find({ key: 'copy' })).toBeUndefined()
    await pane.press({ key: 'prompt-m-2' })
    expect(await pane.find({ key: 'rewind' })).toBeDefined()
    await pane.press({ key: 'cancel' })
    expect(await pane.find({ key: 'copy' })).toBeUndefined()

    await pane.press({ key: 'prompt-m-2' })
    await pane.press({ key: 'copy' })
    await pane.press({ key: 'prompt-m-0' })
    await pane.press({ key: 'rewind' })
    await pane.unmount()
  }

  // The one long text was summarized once, whatever was drawn.
  expect(summarized).toHaveLength(1)
  expect(filled).toEqual(['/code-review high', '/code-review high'])
  expect(commands).toEqual(['rewind', 'rewind'])
})

test('/compass color sets the accent, and refuses what is not a color', async ($, on) => {
  on('session.id', () => ({ value: 'sess-1' }))
  const store = memoryStore(on)
  const run = (args: string) =>
    $.command.run({ command: 'compass', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })

  expect((await run('color pink')).text).toBe('Accent color set to #ec4899.')
  // Pink is the palette's fourth; next is the fifth, whatever the new-session counter says.
  expect((await run('color next')).text).toBe('Accent color set to #8b5cf6.')
  expect(store.get('nextColor')).toBeUndefined()
  expect((await run('color pink')).text).toBe('Accent color set to #ec4899.')
  expect((await run('color #12')).text).toMatch(/^Not a color: "#12"/)
  expect((await run('bogus')).text).toMatch(/^Unknown option "bogus"/)
  expect(store.get('colors')).toEqual({ 'sess-1': '#ec4899' })
})

test('pressing the name opens an editor that renames the session and sets its color', async ($, on) => {
  const renamed: string[] = []
  on('session.id', () => ({ value: 'sess-1' }))
  const store = memoryStore(on)
  on('command.run', { command: 'rename' }, (_, e) => {
    renamed.push(e.args)
    return {}
  })
  on('ui.scroll', () => ({}))
  // The pane is open under the session's old name, as its tab shows.
  on('ui.panes', () => ({ value: [{ id: 'session-compass', title: 'Old name', isShown: true, isFocused: false, isPlaced: true }] }))
  const titles: string[] = []
  on('ui.open', (_, e) => {
    titles.push(e.title ?? '')
    return { value: { isPlaced: true } }
  })

  const pane = await $.ui.mount({
    plugin: 'session-compass',
    surface: 'terminal',
    component: 'Pane',
    props: PANE_PROPS,
    requestId: 'session-compass',
    viewport: VIEWPORT,
  })
  expect(await pane.find({ key: 'name-input' })).toBeUndefined()
  await pane.press({ key: 'edit-identity' })
  expect(await pane.find({ key: 'name-input' })).toBeDefined()

  await pane.input({ key: 'name-input', text: '  Release v2  ' })
  expect(renamed).toEqual(['Release v2'])
  expect(titles).toContain('Release v2')
  expect(await pane.find({ type: 'Text', text: /^Release v2$/ })).toBeDefined()

  // Teal is the eleventh swatch: its hotkey, as Enter on it after Tab would.
  expect(await pane.find({ key: 'color-teal' })).toMatchObject({ props: { hotkey: 'a' } })
  await pane.press({ key: 'color-teal' })
  expect(store.get('colors')).toEqual({ 'sess-1': '#14b8a6' })
  await pane.input({ key: 'hex-input', text: '#ABCDEF' })
  expect(store.get('colors')).toEqual({ 'sess-1': '#abcdef' })
  await pane.input({ key: 'hex-input', text: 'mauve' })
  expect(await pane.find({ type: 'Text', text: /Not a color: "mauve"/ })).toBeDefined()

  await pane.press({ key: 'done' })
  expect(await pane.find({ key: 'name-input' })).toBeUndefined()
  await pane.unmount()
})

test('a cancelled rewind keeps the history; /resume rebuilds it, with the resumed session\'s color and kept summaries', async ($, on) => {
  let rows = ROWS
  let sessionId = 'sess-1'
  const summarized: string[] = []
  on('session.messages', () => ({ value: rows }))
  on('session.id', () => ({ value: sessionId }))
  on('session.root', () => ({ value: '/src/app' }))
  on('session.repo', () => ({ value: null }))
  on('process.run', () => ok(''))
  on('ui.panes', () => ({ value: [] }))
  on('clock.now', () => ({ value: 1_000_000 }))
  on('model.complete', (_, e) => {
    summarized.push(String(e.prompt))
    return { value: { isAnswered: true, text: 'Cleared a stale build cache.', usage: USAGE } }
  })
  const store = memoryStore(on)
  store.set('colors', { 'sess-2': '#14b8a6' })
  const submit = (text: string) => $.prompt.submit({ text, origin: { kind: 'composer' } } as never)
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  on('command.run', { command: 'rewind' }, () => ({}))
  on('classic.SessionStart', () => ({}) as never)

  // A rewind opened and cancelled: the transcript keeps its rows, so the live entries stay.
  await $.command.run({ command: 'rewind', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  await submit('next step')
  const mount = () =>
    $.ui.mount({ plugin: 'session-compass', surface: 'terminal', component: 'Pane', props: PANE_PROPS, requestId: 'session-compass', viewport: VIEWPORT })
  let pane = await mount()
  expect(await pane.find({ type: 'Text', text: /next step/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /why is CI red/ })).toBeUndefined()
  await pane.unmount()

  // /resume into another session: its history, its color.
  sessionId = 'sess-2'
  rows = ROWS
  await $.classic.SessionStart({ source: 'resume' } as never)
  for (let i = 0; i < 200 && summarized.length === 0; i++) await Promise.resolve()
  for (let i = 0; i < 50; i++) await Promise.resolve()
  pane = await mount()
  expect(await pane.find({ type: 'Text', text: /why is CI red/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /next step/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /^Unnamed session$/ })).toMatchObject({ props: { color: '#14b8a6' } })
  await pane.unmount()

  // The summary is kept past the process, under the summaries key.
  expect(summarized).toHaveLength(1)
  expect(Object.values(store.get('summaries') as object)).toContain('Cleared a stale build cache.')
})

test('/clear keeps the ended conversation\'s color; /branch rebuilds the forked history', async ($, on) => {
  let sessionId = 'sess-1'
  on('session.messages', () => ({ value: ROWS }))
  on('session.id', () => ({ value: sessionId }))
  on('session.root', () => ({ value: '/src/app' }))
  on('session.repo', () => ({ value: null }))
  on('process.run', () => ok(''))
  on('ui.panes', () => ({ value: [] }))
  on('model.complete', () => ({ value: { isAnswered: true, text: 'Summary.', usage: USAGE } }))
  on('session.end', () => ({ sessionId }) as never)
  on('classic.SessionStart', () => ({}) as never)
  const store = memoryStore(on)
  store.set('colors', { 'sess-1': '#ec4899' })
  const mount = () =>
    $.ui.mount({ plugin: 'session-compass', surface: 'terminal', component: 'Pane', props: PANE_PROPS, requestId: 'session-compass', viewport: VIEWPORT })

  await $.session.end({ reason: 'clear' } as never)
  sessionId = 'sess-3'
  await $.classic.SessionStart({ source: 'clear' } as never)
  let pane = await mount()
  expect(await pane.find({ type: 'Text', text: /^Unnamed session$/ })).toMatchObject({ props: { color: '#ec4899' } })
  expect(await pane.find({ type: 'Text', text: /why is CI red/ })).toBeUndefined()
  await pane.unmount()
  expect(store.get('colors')).toMatchObject({ 'sess-3': '#ec4899' })

  sessionId = 'sess-4'
  await $.classic.SessionStart({ source: 'fork' } as never)
  pane = await mount()
  expect(await pane.find({ type: 'Text', text: /why is CI red/ })).toBeDefined()
  await pane.unmount()
})
