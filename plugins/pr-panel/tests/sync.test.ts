import { expect, test } from 'claude-code/testing'

import type { Io } from '../hooks/io'
import { LINGER_MS } from '../hooks/derive'
import { createPoller, flushAgent, hurry, refresh, tick, track } from '../hooks/sync'
import type { TrackedPr } from '../types'
import { GRAPH, REF, VIEW } from './fixtures'

/** An Io whose gh answers come from `answer`, recording each argv. */
const fakeIo = (answer: (argv: readonly string[]) => string) => {
  let list: TrackedPr[] = []
  let now = 1_000_000
  const calls: string[][] = []
  const toasts: string[] = []
  const told: string[] = []
  let agentOn = true
  let failSend = false
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
    setNotice: async () => null,
    fill: async () => true,
    tellAgent: async text => {
      if (failSend) throw new Error('busy')
      told.push(text)
    },
    getAgent: async () => agentOn,
    setAgent: async isOn => (agentOn = isOn),
    openPane: async () => ({ isPlaced: true }),
    closePane: async () => void (closes += 1),
  }
  return { io, calls, toasts, told, setAgentOn: (isOn: boolean) => (agentOn = isOn), setFailSend: (fails: boolean) => (failSend = fails), list: () => list, closes: () => closes, advance: (ms: number) => (now += ms) }
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

test('overlapping tracks of one PR add it once', async () => {
  const fake = fakeIo(argv => (argv.includes('-i') ? 'HTTP/2.0 200 OK\n\n{}' : JSON.stringify(isFull(argv) ? VIEW : GRAPH)))
  const poller = createPoller()
  await Promise.all([track(fake.io, poller, [REF]), track(fake.io, poller, [REF])])
  expect(fake.list().length).toBe(1)
})

test('a failed GraphQL fetch is shown and retried, not taken as a full refresh', async () => {
  const fake = fakeIo(argv => (argv.includes('-i') ? 'HTTP/2.0 200 OK\n\n{}' : JSON.stringify(VIEW)))
  const run = fake.io.run
  fake.io.run = async (argv, t) =>
    argv[2] === 'graphql' ? { exitCode: 1, stdout: '', stderr: 'HTTP 502: Bad Gateway' } : run(argv, t)
  const poller = createPoller()
  await track(fake.io, poller, [REF])
  expect(fake.list()[0]?.error).toBe('review threads and merge settings may be stale: HTTP 502: Bad Gateway')
  expect(poller.lastFull.has(REF.url)).toBe(false)
})

test('hurry refetches a closed PR, so a reopen shows', async () => {
  let view: Record<string, unknown> = { ...VIEW, state: 'CLOSED' }
  const fake = fakeIo(argv => (argv.includes('-i') ? 'HTTP/2.0 200 OK\n\n{}' : JSON.stringify(isFull(argv) ? view : GRAPH)))
  const poller = createPoller()
  await track(fake.io, poller, [REF])
  expect(poller.due.get(REF.url)).toBe(Infinity)

  view = VIEW
  await hurry(fake.io, poller)
  expect(fake.list()[0]?.snapshot?.state).toBe('OPEN')
  expect(fake.list()[0]?.endedAt).toBe(null)
})

test('sends new activity to the agent once, as one message, and nothing for the first fetch', async () => {
  let view: Record<string, unknown> = VIEW
  const fake = fakeIo(argv => {
    if (argv.includes('-i')) return 'HTTP/2.0 200 OK\nEtag: W/"3"\n\n{}'
    return JSON.stringify(isFull(argv) ? view : GRAPH)
  })
  const poller = createPoller()
  await track(fake.io, poller, [REF])
  await flushAgent(fake.io, poller)
  expect(fake.told).toEqual([])

  view = { ...VIEW, comments: [...VIEW.comments, { author: { login: 'carol' }, body: 'Why?', url: 'c2', createdAt: '' }, { author: { login: 'me' }, body: 'Done', url: 'c3', createdAt: '' }] }
  await refresh(fake.io, poller, REF)
  await flushAgent(fake.io, poller)
  await flushAgent(fake.io, poller)
  expect(fake.told.length).toBe(1)
  expect(fake.told[0]?.includes('New comment by carol: c2')).toBe(true)
  expect(fake.told[0]?.includes('Done')).toBe(false)
})

test('keeps the outbox when sending fails, and drops it while turned off', async () => {
  let view: Record<string, unknown> = VIEW
  const fake = fakeIo(argv => {
    if (argv.includes('-i')) return 'HTTP/2.0 200 OK\nEtag: W/"4"\n\n{}'
    return JSON.stringify(isFull(argv) ? view : GRAPH)
  })
  const poller = createPoller()
  await track(fake.io, poller, [REF])
  const comment = (n: number) => ({ author: { login: 'carol' }, body: `Q${n}`, url: `q${n}`, createdAt: '' })

  view = { ...VIEW, comments: [...VIEW.comments, comment(1)] }
  await refresh(fake.io, poller, REF)
  fake.setFailSend(true)
  await flushAgent(fake.io, poller)
  expect(poller.outbox.length).toBe(1)
  fake.setFailSend(false)
  await flushAgent(fake.io, poller)
  expect(fake.told.length).toBe(1)
  expect(poller.outbox.length).toBe(0)

  fake.setAgentOn(false)
  view = { ...VIEW, comments: [...VIEW.comments, comment(1), comment(2)] }
  await refresh(fake.io, poller, REF)
  await flushAgent(fake.io, poller)
  expect(fake.told.length).toBe(1)
  expect(poller.outbox.length).toBe(0)
})

test('reports a conflict once across the UNKNOWN that follows a push', async () => {
  let mergeable = 'CONFLICTING'
  const fake = fakeIo(argv => {
    if (argv.includes('-i')) return 'HTTP/2.0 200 OK\nEtag: W/"5"\n\n{}'
    return JSON.stringify(isFull(argv) ? { ...VIEW, mergeable } : GRAPH)
  })
  const poller = createPoller()
  await track(fake.io, poller, [REF])
  for (const state of ['UNKNOWN', 'CONFLICTING']) {
    mergeable = state
    await refresh(fake.io, poller, REF)
  }
  await flushAgent(fake.io, poller)
  expect(fake.told).toEqual([])
})
