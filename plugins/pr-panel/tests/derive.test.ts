import { describe, expect, test } from 'claude-code/testing'

import {
  FAST_POLL_MS,
  IDLE_POLL_MS,
  availableActions,
  mergeBlockers,
  agentEvents,
  diffSnapshots,
  effectiveMethod,
  pollIntervalMs,
  summaryLine,
} from '../hooks/derive'
import type { Check, Thread } from '../types'
import { REF, snapshot } from './fixtures'

const check = (state: Check['state'], runId: string | null = null): Check => ({
  name: `c-${state}`,
  workflow: null,
  state,
  url: null,
  runId,
})

describe('pollIntervalMs', () => {
  test('polls fast while checks run, slowly when idle, never once merged', () => {
    expect(pollIntervalMs(snapshot({ checks: [check('pending')] }))).toBe(FAST_POLL_MS)
    expect(pollIntervalMs(snapshot({ checks: [check('pass')] }))).toBe(IDLE_POLL_MS)
    expect(pollIntervalMs(snapshot({ autoMerge: { method: 'squash' } }))).toBe(FAST_POLL_MS)
    expect(pollIntervalMs(snapshot({ state: 'MERGED' }))).toBe(null)
  })
})

describe('merge method and actions', () => {
  test('follows what the repo allows', () => {
    expect(effectiveMethod(snapshot(), undefined)).toBe('squash')
    expect(effectiveMethod(snapshot(), 'rebase')).toBe('rebase')
    expect(effectiveMethod(snapshot(), 'merge')).toBe('squash')
    expect(effectiveMethod(snapshot({ repo: { methods: [], isAutoMergeAllowed: false } }), undefined)).toBe(null)
  })

  test('offers merge, not auto-merge, on a PR that can merge now, and re-run on a finished failed run', () => {
    expect(availableActions(snapshot({ checks: [check('fail', '1')] }), 'squash')).toEqual(['merge', 'rerun'])
  })

  test('does not offer re-run while the failed run still has jobs going', () => {
    const checks = [check('fail', '1'), { ...check('pending', '1'), name: 'other' }]
    expect(availableActions(snapshot({ checks, mergeStateStatus: 'BLOCKED' }), 'squash')).toEqual(['auto-enable'])
  })

  test('offers ready on a draft and disable once auto-merge is on', () => {
    expect(availableActions(snapshot({ isDraft: true }), 'squash')).toEqual(['ready'])
    expect(availableActions(snapshot({ autoMerge: { method: 'squash' } }), 'squash')).toEqual(['auto-disable', 'merge'])
  })

  test('hides auto-merge the viewer cannot enable, and merge on conflicts', () => {
    const s = snapshot({ mergeable: 'CONFLICTING', viewer: { login: 'me', canMergeAsAdmin: true, canEnableAutoMerge: false } })
    expect(availableActions(s, 'squash')).toEqual([])
    expect(availableActions(snapshot({ state: 'MERGED' }), 'squash')).toEqual([])
  })
})

test('summaryLine compresses the state', () => {
  const s = snapshot({
    checks: [check('pass'), check('fail'), check('pending')],
    threads: [{ id: 't', path: 'a', line: 1, author: 'x', body: 'y', url: 'u', isOutdated: false, replies: [], commentCount: 1 }],
    autoMerge: { method: 'squash' },
  })
  expect(summaryLine({ ref: REF, snapshot: s, error: null, fetchedAt: 0, endedAt: null })).toBe(
    '#42 · ✓1 ✗1 …1 · 1 unresolved · auto-merge: squash',
  )
  expect(summaryLine({ ref: REF, snapshot: null, error: null, fetchedAt: 0, endedAt: null })).toBe('#42 loading…')
})

describe('diffSnapshots', () => {
  test('announces checks finishing', () => {
    const changes = diffSnapshots(42, snapshot({ checks: [check('pending')] }), snapshot({ checks: [check('fail')] }))
    expect(changes).toEqual([{ text: '#42: 1 check failed', isImportant: true }])
  })

  test('announces a merge alone', () => {
    expect(diffSnapshots(42, snapshot(), snapshot({ state: 'MERGED' }))).toEqual([{ text: '#42 merged', isImportant: true }])
  })

  test('announces new reviews and human comments', () => {
    const next = snapshot({
      reviews: [{ id: 'r1', author: 'alice', state: 'CHANGES_REQUESTED', body: '' }],
      comments: [{ author: 'bob', body: 'hi', url: 'u', createdAt: '', isBot: false }],
    })
    expect(diffSnapshots(42, snapshot(), next).map(c => c.text)).toEqual(['#42: alice changes requested', '#42: 1 new comment'])
  })

  test('stays quiet when nothing changed', () => {
    expect(diffSnapshots(42, snapshot(), snapshot())).toEqual([])
  })
})

describe('blocked merges', () => {
  const blocked = snapshot({
    mergeStateStatus: 'BLOCKED',
    threads: [{ id: 't', path: 'a', line: 1, author: 'x', body: 'y', url: 'u', isOutdated: false, replies: [], commentCount: 1 }],
  })

  test('offers no merge while blocked, and a bypass only to an admin', () => {
    expect(availableActions(blocked, 'squash')).toEqual(['auto-enable'])
    const admin = { ...blocked, viewer: { login: 'me', canMergeAsAdmin: true, canEnableAutoMerge: true } }
    expect(availableActions(admin, 'squash')).toEqual(['auto-enable', 'bypass'])
  })

  test('says why', () => {
    expect(mergeBlockers(blocked)).toEqual(['1 unresolved thread'])
    expect(mergeBlockers(snapshot({ mergeStateStatus: 'BLOCKED' }))).toEqual(['branch protection rules'])
    expect(mergeBlockers(snapshot({ mergeStateStatus: 'BEHIND' }))).toEqual(['the branch is behind main'])
    expect(mergeBlockers(snapshot())).toEqual([])
  })
})

describe('diffSnapshots by identity', () => {
  const thread = (id: string) => ({ id, path: 'a', line: 1, author: 'x', body: 'y', url: 'u', isOutdated: false, replies: [], commentCount: 1 })

  test('announces a second review in the same state', () => {
    const prev = snapshot({ reviews: [{ id: 'r1', author: 'alice', state: 'COMMENTED', body: '' }] })
    const next = snapshot({ reviews: [{ id: 'r2', author: 'alice', state: 'COMMENTED', body: '' }] })
    expect(diffSnapshots(42, prev, next).map(c => c.text)).toEqual(['#42: alice commented'])
  })

  test('announces a new thread even when another was resolved', () => {
    const changes = diffSnapshots(42, snapshot({ threads: [thread('a')] }), snapshot({ threads: [thread('b')] }))
    expect(changes.map(c => c.text)).toEqual(['#42: 1 new unresolved thread'])
  })

  test('announces checks that went from absent to finished', () => {
    const changes = diffSnapshots(42, snapshot({ checks: [] }), snapshot({ checks: [check('pass')] }))
    expect(changes.map(c => c.text)).toEqual(['#42: all checks passed'])
  })
})

describe('agentEvents', () => {
  const thread = (over: Partial<Thread> = {}): Thread => ({
    id: 't1', path: 'src/a.ts', line: 3, author: 'alice', body: 'Handle null', url: 'u', isOutdated: false, replies: [], commentCount: 1, ...over,
  })
  const comment = (author: string, url: string, isBot = false) => ({ author, body: 'hi', url, createdAt: '', isBot })
  const kinds = (events: ReturnType<typeof agentEvents>) => events.map(e => e.kind)

  test('reports checks that finished failing, not passing', () => {
    expect(kinds(agentEvents(snapshot({ checks: [check('pending')] }), snapshot({ checks: [check('fail'), check('pass')] }), 'MERGEABLE'))).toEqual(['checks-failed'])
    expect(agentEvents(snapshot({ checks: [check('pending')] }), snapshot({ checks: [check('pass')] }), 'MERGEABLE')).toEqual([])
  })

  test('reports a conflict once, not again as GitHub recomputes it', () => {
    expect(agentEvents(snapshot(), snapshot({ mergeable: 'CONFLICTING' }), 'MERGEABLE')).toEqual([{ kind: 'conflict', base: 'main' }])
    // CONFLICTING -> UNKNOWN (a push) -> CONFLICTING: the last known state is still CONFLICTING.
    expect(agentEvents(snapshot({ mergeable: 'UNKNOWN' }), snapshot({ mergeable: 'CONFLICTING' }), 'CONFLICTING')).toEqual([])
    expect(kinds(agentEvents(snapshot({ mergeable: 'UNKNOWN' }), snapshot({ mergeable: 'CONFLICTING' }), 'MERGEABLE'))).toEqual(['conflict'])
  })

  test("reports others' threads, replies and comments, not the gh account's or bots'", () => {
    const prev = snapshot({ threads: [thread()], comments: [comment('bob', 'c0')] })
    const next = snapshot({
      threads: [thread({ replies: [{ author: 'bob', body: 'still null' }], commentCount: 2 }), thread({ id: 't2', author: 'me' }), thread({ id: 't3', author: 'carol' })],
      comments: [comment('bob', 'c0'), comment('me', 'c1'), comment('ci[bot]', 'c2', true), comment('dave', 'c3')],
    })
    expect(agentEvents(prev, next, 'MERGEABLE').map(e => `${e.kind}:${'thread' in e ? e.thread.id : 'comment' in e ? e.comment.author : ''}`)).toEqual([
      'reply:t1',
      'thread:t3',
      'comment:dave',
    ])
  })

  test("reports a reviewer's reply even when the gh account replied after it in the same poll", () => {
    const next = snapshot({
      threads: [thread({ replies: [{ author: 'bob', body: 'still null' }, { author: 'me', body: 'Fixed in abc' }], commentCount: 3 })],
    })
    const [event] = agentEvents(snapshot({ threads: [thread()] }), next, 'MERGEABLE')
    expect(event).toMatchObject({ kind: 'reply', count: 2, replies: [{ author: 'bob', body: 'still null' }] })
    const own = snapshot({ threads: [thread({ replies: [{ author: 'me', body: 'Fixed' }], commentCount: 2 })] })
    expect(agentEvents(snapshot({ threads: [thread()] }), own, 'MERGEABLE')).toEqual([])
  })

  test('reports replies it cannot see on a thread past its fetched page by count', () => {
    const next = snapshot({ threads: [thread({ replies: [{ author: 'bob', body: 'x' }], commentCount: 25 })] })
    expect(agentEvents(snapshot({ threads: [thread({ commentCount: 24 })] }), next, 'MERGEABLE')).toEqual([
      { kind: 'reply', thread: next.threads[0]!, count: 1, replies: null },
    ])
  })

  test('does not take a thread for new while the PR has more threads than one page', () => {
    const next = snapshot({ hasMoreThreads: true, threads: [thread({ id: 't9' })] })
    expect(agentEvents(snapshot({ hasMoreThreads: true }), next, 'MERGEABLE')).toEqual([])
  })

  test('reports only CI and conflicts until the gh account is known', () => {
    const unknown = { login: null, canMergeAsAdmin: false, canEnableAutoMerge: false }
    const prev = snapshot({ viewer: unknown, checks: [check('pending')] })
    const next = snapshot({ threads: [thread()], comments: [comment('me', 'c1')], checks: [check('fail')], mergeable: 'CONFLICTING' })
    expect(kinds(agentEvents(prev, next, 'MERGEABLE'))).toEqual(['checks-failed', 'conflict'])
  })

  test('reports changes requested and commented reviews with a body', () => {
    const next = snapshot({
      reviews: [
        { id: 'r1', author: 'alice', state: 'CHANGES_REQUESTED', body: '' },
        { id: 'r2', author: 'bob', state: 'COMMENTED', body: 'nit' },
        { id: 'r3', author: 'carol', state: 'APPROVED', body: '' },
        { id: 'r4', author: 'me', state: 'COMMENTED', body: 'replying' },
      ],
    })
    expect(agentEvents(snapshot(), next, 'MERGEABLE').map(e => (e.kind === 'review' ? e.review.id : e.kind))).toEqual(['r1', 'r2'])
  })

  test('says nothing about a merged PR', () => {
    expect(agentEvents(snapshot(), snapshot({ state: 'MERGED', mergeable: 'CONFLICTING' }), 'MERGEABLE')).toEqual([])
  })
})
