import type { PrRef, PrSnapshot } from '../types'

export const REF: PrRef = {
  url: 'https://github.com/acme/app/pull/42',
  host: 'github.com',
  owner: 'acme',
  repo: 'app',
  number: 42,
}

export const VIEW = {
  title: 'Add the thing',
  state: 'OPEN',
  isDraft: false,
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'BLOCKED',
  reviewDecision: 'REVIEW_REQUIRED',
  headRefName: 'feat/thing',
  baseRefName: 'main',
  headRefOid: 'abc123',
  autoMergeRequest: null,
  statusCheckRollup: [
    {
      __typename: 'CheckRun',
      name: 'lint',
      workflowName: 'CI',
      status: 'COMPLETED',
      conclusion: 'FAILURE',
      detailsUrl: 'https://github.com/acme/app/actions/runs/111/job/222',
    },
    { __typename: 'CheckRun', name: 'unit', workflowName: 'CI', status: 'IN_PROGRESS', conclusion: '', detailsUrl: '' },
    { __typename: 'CheckRun', name: 'build', workflowName: 'CI', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: '' },
    { __typename: 'StatusContext', context: 'deploy/preview', state: 'SUCCESS', targetUrl: 'https://preview.example' },
  ],
  latestReviews: [{ author: { login: 'alice' }, state: 'COMMENTED', body: 'Looks close' }],
  comments: [
    { author: { login: 'bob' }, body: 'Can we rename this?', url: 'https://github.com/acme/app/pull/42#c1', createdAt: '2026-10-01T00:00:00Z' },
    { author: { login: 'chatgpt-codex-connector' }, body: 'Review summary', url: 'u', createdAt: '2026-10-01T00:00:00Z' },
  ],
}

export const GRAPH = {
  data: {
    repository: {
      squashMergeAllowed: true,
      mergeCommitAllowed: false,
      rebaseMergeAllowed: true,
      autoMergeAllowed: true,
      pullRequest: {
        reviewThreads: {
          nodes: [
            {
              id: 'PRRT_1',
              isResolved: false,
              isOutdated: false,
              path: 'src/thing.ts',
              line: 12,
              comments: {
                nodes: [
                  { author: { login: 'alice' }, body: 'Handle null here', url: 'https://github.com/acme/app/pull/42#t1' },
                  { author: { login: 'bob' }, body: 'Agreed, it can be null after a reset', url: 'u2' },
                ],
              },
            },
            { isResolved: true, isOutdated: false, path: 'src/old.ts', line: 3, comments: { nodes: [] } },
          ],
        },
      },
    },
  },
}

export const snapshot = (over: Partial<PrSnapshot> = {}): PrSnapshot => ({
  title: 'Add the thing',
  state: 'OPEN',
  isDraft: false,
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  reviewDecision: '',
  headRefName: 'feat/thing',
  baseRefName: 'main',
  headSha: 'abc123',
  autoMerge: null,
  checks: [],
  reviews: [],
  comments: [],
  threads: [],
  repo: { methods: ['squash', 'rebase'], isAutoMergeAllowed: true },
  ...over,
})
