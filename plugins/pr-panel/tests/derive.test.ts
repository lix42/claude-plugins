import { describe, expect, test } from 'claude-code/testing'

import {
  FAST_POLL_MS,
  IDLE_POLL_MS,
  availableActions,
  mergeBlockers,
  diffSnapshots,
  effectiveMethod,
  pollIntervalMs,
  summaryLine,
} from '../hooks/derive'
import type { Check } from '../types'
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
    const s = snapshot({ mergeable: 'CONFLICTING', viewer: { canMergeAsAdmin: true, canEnableAutoMerge: false } })
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
    const admin = { ...blocked, viewer: { canMergeAsAdmin: true, canEnableAutoMerge: true } }
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
