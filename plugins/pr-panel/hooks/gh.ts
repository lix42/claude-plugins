import type { MergeMethod, PrRef } from '../types'
import type { Io } from './io'

export const PR_VIEW_FIELDS = [
  'title',
  'state',
  'isDraft',
  'mergeable',
  'mergeStateStatus',
  'reviewDecision',
  'headRefName',
  'baseRefName',
  'headRefOid',
  'autoMergeRequest',
  'statusCheckRollup',
  'latestReviews',
  'comments',
].join(',')

const THREADS_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $repo) {
    squashMergeAllowed mergeCommitAllowed rebaseMergeAllowed autoMergeAllowed
    pullRequest(number: $number) {
      viewerCanMergeAsAdmin viewerCanEnableAutoMerge
      reviewThreads(first: 100) {
        pageInfo { hasNextPage }
        nodes {
          id isResolved isOutdated path line
          comments(first: 20) { totalCount nodes { author { login } body url } }
        }
      }
    }
  }
}`

const slug = (ref: PrRef) => `${ref.owner}/${ref.repo}`
const repoFlag = (ref: PrRef) => ['-R', `${ref.host}/${slug(ref)}`]

export const prViewArgv = (ref: PrRef) => ['gh', 'pr', 'view', ref.url, '--json', PR_VIEW_FIELDS]

export const currentBranchPrArgv = () => ['gh', 'pr', 'view', '--json', 'url,state']

export const threadsArgv = (ref: PrRef) => [
  'gh', 'api', 'graphql', '--hostname', ref.host,
  '-f', `query=${THREADS_QUERY}`,
  '-F', `owner=${ref.owner}`, '-F', `repo=${ref.repo}`, '-F', `number=${ref.number}`,
]

/** A conditional GET whose 304 answer does not count against the rate limit. */
export const probeArgv = (ref: PrRef, path: string, etag: string | null) => [
  'gh', 'api', '-i', '--hostname', ref.host,
  ...(etag ? ['-H', `If-None-Match: ${etag}`] : []),
  path,
]

export const probePaths = (ref: PrRef, headSha: string | null): string[] => [
  `repos/${slug(ref)}/pulls/${ref.number}`,
  ...(headSha
    ? [
        `repos/${slug(ref)}/commits/${headSha}/check-runs?per_page=100`,
        `repos/${slug(ref)}/commits/${headSha}/status?per_page=100`,
      ]
    : []),
]

/** `now` merges, `auto` queues auto-merge, `admin` bypasses the branch rules. */
export type MergeMode = 'now' | 'auto' | 'admin'

/** Pinned to `headSha`, so a push after the pane was drawn makes the merge fail rather than take unseen commits. */
export const mergeArgv = (ref: PrRef, method: MergeMethod, mode: MergeMode, headSha: string) => [
  'gh', 'pr', 'merge', ref.url, `--${method}`, ...(mode === 'now' ? [] : [`--${mode}`]),
  '--match-head-commit', headSha,
]

export const disableAutoArgv = (ref: PrRef) => ['gh', 'pr', 'merge', ref.url, '--disable-auto']

export const readyArgv = (ref: PrRef) => ['gh', 'pr', 'ready', ref.url]

export const rerunArgv = (ref: PrRef, runId: string) => ['gh', 'run', 'rerun', runId, '--failed', ...repoFlag(ref)]

export const failedLogArgv = (ref: PrRef, runId: string) => ['gh', 'run', 'view', runId, '--log-failed', ...repoFlag(ref)]

export type GhResult = { isOk: boolean; stdout: string; error: string }

export const runGh = async (io: Io, argv: readonly string[], timeoutMs = 30_000): Promise<GhResult> => {
  try {
    const { exitCode, stdout, stderr } = await io.run(argv, timeoutMs)
    return { isOk: exitCode === 0, stdout, error: stderr.trim() || `exit ${exitCode}` }
  } catch (error) {
    return { isOk: false, stdout: '', error: error instanceof Error ? error.message : String(error) }
  }
}
