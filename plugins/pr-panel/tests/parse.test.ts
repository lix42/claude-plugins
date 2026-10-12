import { describe, expect, test } from 'claude-code/testing'

import { extractPrRefs, parseHttpReply, parsePrArg, parseSnapshot } from '../hooks/parse'
import { GRAPH, REF, VIEW } from './fixtures'

describe('extractPrRefs', () => {
  test('finds each PR URL once, including enterprise hosts', () => {
    const text = `Created ${REF.url}\nsee ${REF.url} and https://ghe.corp/x/y/pull/7`
    const refs = extractPrRefs(text)
    expect(refs.map(r => r.url)).toEqual([REF.url, 'https://ghe.corp/x/y/pull/7'])
    expect(refs[1]).toMatchObject({ host: 'ghe.corp', owner: 'x', repo: 'y', number: 7 })
  })

  test('ignores pull/new links that git push prints', () => {
    expect(extractPrRefs('visit https://github.com/acme/app/pull/new/feat')).toEqual([])
  })
})

test('parsePrArg resolves a bare number against the fallback repo', () => {
  expect(parsePrArg('#9', REF)?.url).toBe('https://github.com/acme/app/pull/9')
  expect(parsePrArg('9', null)).toBe(null)
  expect(parsePrArg('nope', REF)).toBe(null)
})

describe('parseSnapshot', () => {
  const s = parseSnapshot(VIEW, GRAPH)

  test('maps checks to states and Actions run ids', () => {
    expect(s.checks.map(c => [c.name, c.state, c.runId])).toEqual([
      ['lint', 'fail', '111'],
      ['unit', 'pending', null],
      ['build', 'pass', null],
      ['deploy/preview', 'pass', null],
    ])
  })

  test('keeps only unresolved threads', () => {
    expect(s.threads).toEqual([
      {
        id: 'PRRT_1',
        path: 'src/thing.ts',
        line: 12,
        author: 'alice',
        body: 'Handle null here',
        url: 'https://github.com/acme/app/pull/42#t1',
        isOutdated: false,
        replies: [{ author: 'bob', body: 'Agreed, it can be null after a reset' }],
      },
    ])
  })

  test('reads allowed merge methods and marks bot comments', () => {
    expect(s.repo).toEqual({ methods: ['squash', 'rebase'], isAutoMergeAllowed: true })
    expect(s.comments.map(c => c.isBot)).toEqual([false, true])
  })

  test('reads the auto-merge method', () => {
    expect(parseSnapshot({ ...VIEW, autoMergeRequest: { mergeMethod: 'SQUASH' } }, GRAPH).autoMerge).toEqual({ method: 'squash' })
  })

  test('survives a missing GraphQL answer', () => {
    const bare = parseSnapshot(VIEW, null)
    expect(bare.threads).toEqual([])
    expect(bare.repo.methods).toEqual([])
  })
})

test('parseHttpReply reads the status and ETag of gh api -i', () => {
  expect(parseHttpReply('HTTP/2.0 304 Not Modified\r\nEtag: W/"abc"\r\n\r\n')).toEqual({ status: 304, etag: 'W/"abc"' })
  expect(parseHttpReply('')).toEqual({ status: 0, etag: null })
})
