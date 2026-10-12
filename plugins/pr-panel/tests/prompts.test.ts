import { expect, test } from 'claude-code/testing'

import { fixCheckPrompt, fixThreadPrompt, tailLines } from '../hooks/prompts'
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
    path: 'src/a.ts',
    line: 3,
    author: 'alice',
    body: 'two\nlines',
    url: 'https://t',
    isOutdated: false,
  })
  expect(text.includes('at src/a.ts:3:')).toBe(true)
  expect(text.includes('> two\n> lines')).toBe(true)
})
