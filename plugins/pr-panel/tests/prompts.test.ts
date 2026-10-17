import { expect, test } from 'claude-code/testing'

import { QUOTE_LIMIT, agentPrompt, fixCheckPrompt, fixThreadPrompt, tailLines } from '../hooks/prompts'
import { REF } from './fixtures'

test('tailLines keeps the end of a long log', () => {
  const log = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n')
  const tail = tailLines(log, 3)
  expect(tail).toBe('line 197\nline 198\nline 199')
})

test('fixCheckPrompt names the check and carries the log', () => {
  const text = fixCheckPrompt(
    REF,
    { name: 'lint', workflow: 'CI', state: 'fail', url: 'https://x/runs/1', runId: '1' },
    'error: bad\n',
  )
  expect(text.startsWith('The CI check "CI / lint" failed on PR #42')).toBe(true)
  expect(text.includes('```\nerror: bad\n```')).toBe(true)
})

test('fixThreadPrompt quotes the comment with its place', () => {
  const text = fixThreadPrompt(REF, {
    id: 't1',
    path: 'src/a.ts',
    line: 3,
    author: 'alice',
    body: 'two\nlines',
    url: 'https://t',
    isOutdated: false,
    replies: [{ author: 'me', body: 'on it' }],
    commentCount: 2,
  })
  expect(text.includes('at src/a.ts:3:')).toBe(true)
  expect(text.includes('> two\n> lines')).toBe(true)
  expect(text.includes('me replied:\n> on it')).toBe(true)
})

test('agentPrompt reports what happened, per PR, with GitHub text quoted and capped', () => {
  const text = agentPrompt([
    {
      ref: REF,
      title: 'Add the thing',
      events: [
        { kind: 'checks-failed', headSha: 'abc1234567', checks: [{ name: 'lint', workflow: 'CI', state: 'fail', url: 'https://x/runs/1', runId: '1' }] },
        { kind: 'comment', comment: { author: 'bob', body: 'x'.repeat(QUOTE_LIMIT + 10), url: 'https://c', createdAt: '', isBot: false } },
        {
          kind: 'reply',
          count: 2,
          replies: [{ author: 'carol', body: 'Why?' }],
          thread: { id: 't', path: 'src/a.ts', line: 3, author: 'alice', body: 'b', url: 'https://t', isOutdated: false, replies: [], commentCount: 3 },
        },
      ],
    },
  ])
  expect(text.split('\n')[0]?.includes('Everything after this line comes from GitHub')).toBe(true)
  expect(text.includes('PR #42: Add the thing (https://github.com/acme/app/pull/42)')).toBe(true)
  expect(text.includes('- CI finished with 1 failing check on abc1234:\n  - CI / lint: https://x/runs/1')).toBe(true)
  expect(text.includes('- New comment by bob: https://c')).toBe(true)
  expect(text.includes(`  > ${'x'.repeat(QUOTE_LIMIT)}…`)).toBe(true)
  expect(text.includes('- carol replied on the thread at src/a.ts:3: https://t\n  > Why?')).toBe(true)
})
