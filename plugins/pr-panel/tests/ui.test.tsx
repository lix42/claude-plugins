import { expect, test } from 'claude-code/testing'

import { GRAPH, REF, VIEW } from './fixtures'

const VIEWPORT = { columns: 160, rows: 40 }
const SITE = { scroll: { offset: 0, bodyRows: 30 }, view: {} }
const PANE_PROPS = { title: 'PRs', isFocused: false, bodyColumns: 80, placement: 'dock' as const, ...SITE }
const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 160, scroll: { offset: 0, bodyRows: 4 }, view: {} }

const gh = (argv: readonly string[]) => {
  if (argv.includes('-i')) return 'HTTP/2.0 200 OK\nEtag: W/"1"\n\n{}'
  if (argv[1] === 'pr' && argv[2] === 'view') return JSON.stringify(VIEW)
  return JSON.stringify(GRAPH)
}

test('/pr <url> tracks the PR and draws it in the pane and the band', async ($, on) => {
  on('process.run', (_, e) => ({
    value: { exitCode: 0, stdout: gh(e.argv), stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.now', () => ({ value: 1_000_000 }))

  const ran = await $.command.run({
    command: 'pr',
    args: REF.url,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 160 },
  })
  expect(ran.text).toBe('Tracking #42.')

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: 'pr-panel', surface, component: 'Pane', props: PANE_PROPS, requestId: 'pr-panel', viewport: VIEWPORT })
    expect(await pane.find({ type: 'Text', text: /Add the thing/ })).toBeDefined()
    expect(await pane.find({ key: 'fix-check-0' })).toBeDefined()
    expect(await pane.find({ key: 'fix-thread-0' })).toBeDefined()
    expect(await pane.find({ key: 'action-auto-enable' })).toBeDefined()
    expect(await pane.find({ key: 'method-rebase' })).toBeDefined()
    // One PR: no tab row.
    expect(await pane.find({ key: `tab-${REF.url}` })).toBeUndefined()

    // A thread opens on press to show its whole conversation, and closes again.
    expect(await pane.find({ key: 'thread-body-0' })).toBeUndefined()
    await pane.press({ key: 'toggle-thread-0' })
    expect((await pane.find({ key: 'thread-body-0' }))?.text).toMatch(/Agreed, it can be null/)
    await pane.press({ key: 'toggle-thread-0' })
    expect(await pane.find({ key: 'thread-body-0' })).toBeUndefined()
    await pane.unmount()

    const band = await $.ui.mount({ plugin: 'pr-panel', surface, component: 'AbovePrompt', props: BAND_PROPS, viewport: VIEWPORT })
    expect(await band.find({ type: 'Text', text: /#42 · ✓2 ✗1 …1 · 1 unresolved/ })).toBeDefined()
    await band.unmount()
  }
})

test('a blocked PR offers a confirmed bypass, and a failed action shows its error in the pane', async ($, on) => {
  const merges: string[][] = []
  on('process.run', (_, e) => {
    if (e.argv[2] === 'merge') {
      merges.push([...e.argv])
      return {
        value: {
          exitCode: 1,
          stdout: '',
          stderr: 'X Pull request acme/app#42 is not mergeable: the base branch policy prohibits the merge.\n',
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      }
    }
    return { value: { exitCode: 0, stdout: gh(e.argv), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1_000_000 }))

  await $.command.run({
    command: 'pr',
    args: REF.url,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 160 },
  })
  const pane = await $.ui.mount({ plugin: 'pr-panel', surface: 'terminal', component: 'Pane', props: PANE_PROPS, requestId: 'pr-panel', viewport: VIEWPORT })

  expect(await pane.find({ key: 'action-merge' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /Merge blocked: 1 unresolved thread, a review is required, 1 failing check, 1 pending check/ })).toBeDefined()

  // The first press only asks; Cancel backs out without running anything.
  await pane.press({ key: 'action-bypass' })
  expect(await pane.find({ type: 'Text', text: /Bypass rules and squash and merge now\?/ })).toBeDefined()
  await pane.press({ key: 'cancel' })
  expect(await pane.find({ key: 'confirm' })).toBeUndefined()
  expect(merges).toEqual([])

  await pane.press({ key: 'action-bypass' })
  await pane.press({ key: 'confirm' })
  expect(merges).toEqual([['gh', 'pr', 'merge', REF.url, '--squash', '--admin']])
  expect(
    await pane.find({ type: 'Text', text: /#42 Bypass rules and squash and merge failed: Pull request acme\/app#42 is not mergeable/ }),
  ).toBeDefined()

  await pane.press({ key: 'dismiss-notice' })
  expect(await pane.find({ type: 'Text', text: /failed:/ })).toBeUndefined()
  await pane.unmount()
})
