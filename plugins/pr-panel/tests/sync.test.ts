import { expect, test } from 'claude-code/testing'

import type { Io } from '../hooks/io'
import { LINGER_MS } from '../hooks/derive'
import { createPoller, refresh, tick, track } from '../hooks/sync'
import type { TrackedPr } from '../types'
import { GRAPH, REF, VIEW } from './fixtures'

/** An Io whose gh answers come from `answer`, recording each argv. */
const fakeIo = (answer: (argv: readonly string[]) => string) => {
  let list: TrackedPr[] = []
  let now = 1_000_000
  const calls: string[][] = []
  const toasts: string[] = []
  let closes = 0
  const io: Io = {
    run: async argv => {
      calls.push([...argv])
      return { exitCode: 0, stdout: answer(argv), stderr: '' }
    },
    now: async () => now,
    getPrs: async () => list,
    updatePrs: async fn => (list = fn(list)),
    updateSelected: async () => null,
    setBusy: async () => null,
    setMethod: async () => null,
    toast: text => void toasts.push(text),
    notify: async () => null,
    ask: async () => 'Cancel',
    fill: async () => true,
    openPane: async () => ({ isPlaced: true }),
    closePane: async () => void (closes += 1),
  }
  return { io, calls, toasts, list: () => list, closes: () => closes, advance: (ms: number) => (now += ms) }
}

const isFull = (argv: readonly string[]) => argv[1] === 'pr' && argv[2] === 'view'

test('fetches in full once, then only probes while nothing changes', async () => {
  let status = 200
  const fake = fakeIo(argv => {
    if (argv.includes('-i')) return `HTTP/2.0 ${status} OK\nEtag: W/"1"\n\n{}`
    return JSON.stringify(isFull(argv) ? VIEW : GRAPH)
  })
  const poller = createPoller()

  await track(fake.io, poller, [REF])
  expect(fake.list()[0]?.snapshot?.title).toBe('Add the thing')
  expect(fake.calls.filter(isFull).length).toBe(1)

  status = 304
  fake.advance(20_000)
  await refresh(fake.io, poller, REF)
  expect(fake.calls.filter(isFull).length).toBe(1)
  expect(fake.calls.at(-1)).toContain('If-None-Match: W/"1"')
})

test('fetches again and announces when a probe sees a change', async () => {
  let view: Record<string, unknown> = VIEW
  const fake = fakeIo(argv => {
    if (argv.includes('-i')) return 'HTTP/2.0 200 OK\nEtag: W/"2"\n\n{}'
    return JSON.stringify(isFull(argv) ? view : GRAPH)
  })
  const poller = createPoller()
  await track(fake.io, poller, [REF])

  view = { ...VIEW, state: 'MERGED' }
  await refresh(fake.io, poller, REF)
  expect(fake.list()[0]?.snapshot?.state).toBe('MERGED')
  expect(fake.toasts).toEqual(['#42 merged'])
  expect(poller.due.get(REF.url)).toBe(Infinity)
})

test('keeps the PR and shows the error when gh fails', async () => {
  const fake = fakeIo(() => '')
  fake.io.run = async () => ({ exitCode: 1, stdout: '', stderr: 'gh: not logged in' })
  await track(fake.io, createPoller(), [REF])
  expect(fake.list()[0]).toMatchObject({ snapshot: null, error: 'gh: not logged in' })
})

test('a merged PR stays on screen for LINGER_MS, then is untracked and the pane closes', async () => {
  let view: Record<string, unknown> = VIEW
  const fake = fakeIo(argv => {
    if (argv.includes('-i')) return 'HTTP/2.0 200 OK\nEtag: W/"3"\n\n{}'
    return JSON.stringify(isFull(argv) ? view : GRAPH)
  })
  const poller = createPoller()
  await track(fake.io, poller, [REF])

  view = { ...VIEW, state: 'MERGED' }
  await refresh(fake.io, poller, REF)
  expect(fake.list()[0]?.endedAt).toBe(1_000_000)

  fake.advance(LINGER_MS - 1)
  await tick(fake.io, poller)
  expect(fake.list().length).toBe(1)

  fake.advance(1)
  await tick(fake.io, poller)
  expect(fake.list()).toEqual([])
  expect(fake.closes()).toBe(1)
})
