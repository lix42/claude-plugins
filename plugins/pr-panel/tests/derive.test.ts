import { describe, expect, test } from 'claude-code/testing'

import {
  FAST_POLL_MS,
  IDLE_POLL_MS,
  availableActions,
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

  test('offers auto-merge, merge and re-run on an open PR with a failed run', () => {
    expect(availableActions(snapshot({ checks: [check('fail', '1')] }), 'squash')).toEqual(['auto-enable', 'merge', 'rerun'])
  })

  test('offers ready on a draft and disable once auto-merge is on', () => {
    expect(availableActions(snapshot({ isDraft: true }), 'squash')).toEqual(['ready'])
    expect(availableActions(snapshot({ autoMerge: { method: 'squash' } }), 'squash')).toEqual(['auto-disable', 'merge'])
  })

  test('hides auto-merge where the repo disallows it, and merge on conflicts', () => {
    const s = snapshot({ mergeable: 'CONFLICTING', repo: { methods: ['squash'], isAutoMergeAllowed: false } })
    expect(availableActions(s, 'squash')).toEqual([])
    expect(availableActions(snapshot({ state: 'MERGED' }), 'squash')).toEqual([])
  })
})

test('summaryLine compresses the state', () => {
  const s = snapshot({
    checks: [check('pass'), check('fail'), check('pending')],
    threads: [{ path: 'a', line: 1, author: 'x', body: 'y', url: 'u', isOutdated: false }],
    autoMerge: { method: 'squash' },
  })
  expect(summaryLine({ ref: REF, snapshot: s, error: null, fetchedAt: 0 })).toBe(
    '#42 · ✓1 ✗1 …1 · 1 unresolved · auto-merge: squash',
  )
  expect(summaryLine({ ref: REF, snapshot: null, error: null, fetchedAt: 0 })).toBe('#42 loading…')
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
      reviews: [{ author: 'alice', state: 'CHANGES_REQUESTED', body: '' }],
      comments: [{ author: 'bob', body: 'hi', url: 'u', createdAt: '', isBot: false }],
    })
    expect(diffSnapshots(42, snapshot(), next).map(c => c.text)).toEqual(['#42: alice changes requested', '#42: 1 new comment'])
  })

  test('stays quiet when nothing changed', () => {
    expect(diffSnapshots(42, snapshot(), snapshot())).toEqual([])
  })
})
