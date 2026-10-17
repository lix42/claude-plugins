import type {
  Check,
  CheckState,
  Comment,
  MergeMethod,
  PrRef,
  PrSnapshot,
  RepoSettings,
  Review,
  Thread,
} from '../types'

const PR_URL = /https?:\/\/([^/\s]+)\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g
const RUN_ID = /\/actions\/runs\/(\d+)/
const BOT = /\[bot\]$|-bot$|^copilot-|-connector$|^github-actions$/i

export const toRef = (match: RegExpMatchArray): PrRef => {
  const [, host = '', owner = '', repo = '', number = '0'] = match
  return {
    url: `https://${host}/${owner}/${repo}/pull/${number}`,
    host,
    owner,
    repo,
    number: Number(number),
  }
}

/** Every distinct PR URL in `text`, in order of first appearance. */
export const extractPrRefs = (text: string): PrRef[] => {
  const seen = new Set<string>()
  const refs: PrRef[] = []
  for (const match of text.matchAll(PR_URL)) {
    const ref = toRef(match)
    if (!seen.has(ref.url)) {
      seen.add(ref.url)
      refs.push(ref)
    }
  }
  return refs
}

/** A PR URL, or a number resolved against `fallback`'s repo. */
export const parsePrArg = (arg: string, fallback: PrRef | null): PrRef | null => {
  const [ref] = extractPrRefs(arg)
  if (ref) return ref
  const number = /^#?(\d+)$/.exec(arg.trim())
  if (number && fallback) {
    const n = Number(number[1])
    return {
      ...fallback,
      number: n,
      url: `https://${fallback.host}/${fallback.owner}/${fallback.repo}/pull/${n}`,
    }
  }
  return null
}

export const isBot = (login: string): boolean => BOT.test(login)

const checkState = (raw: Record<string, unknown>): CheckState => {
  if (raw.__typename === 'StatusContext') {
    const state = String(raw.state ?? '')
    if (state === 'SUCCESS') return 'pass'
    if (state === 'FAILURE' || state === 'ERROR') return 'fail'
    return 'pending'
  }
  if (raw.status !== 'COMPLETED') return 'pending'
  const conclusion = String(raw.conclusion ?? '')
  if (conclusion === 'SUCCESS' || conclusion === 'NEUTRAL') return 'pass'
  if (conclusion === 'SKIPPED') return 'skipped'
  return 'fail'
}

export const parseCheck = (raw: Record<string, unknown>): Check => {
  const url = (raw.detailsUrl ?? raw.targetUrl ?? null) as string | null
  return {
    name: String(raw.name ?? raw.context ?? 'check'),
    workflow: (raw.workflowName as string | undefined) || null,
    state: checkState(raw),
    url: url || null,
    runId: url ? (RUN_ID.exec(url)?.[1] ?? null) : null,
  }
}

const login = (author: unknown): string =>
  (author as { login?: string } | null)?.login ?? 'ghost'

const toMethod = (raw: unknown): MergeMethod | null => {
  const value = String(raw ?? '').toLowerCase()
  return value === 'squash' || value === 'merge' || value === 'rebase' ? value : null
}

/** `gh pr view --json` (see PR_VIEW_FIELDS) and the GraphQL threads/repo answer, as one snapshot. */
export const parseSnapshot = (view: any, graph: any): PrSnapshot => {
  const pr = graph?.data?.repository?.pullRequest
  const repoRaw = graph?.data?.repository ?? {}
  const method = toMethod(view.autoMergeRequest?.mergeMethod)

  return {
    title: String(view.title ?? ''),
    state: view.state === 'MERGED' || view.state === 'CLOSED' ? view.state : 'OPEN',
    isDraft: Boolean(view.isDraft),
    mergeable: String(view.mergeable ?? ''),
    mergeStateStatus: String(view.mergeStateStatus ?? ''),
    reviewDecision: String(view.reviewDecision ?? ''),
    headRefName: String(view.headRefName ?? ''),
    baseRefName: String(view.baseRefName ?? ''),
    headSha: String(view.headRefOid ?? ''),
    autoMerge: view.autoMergeRequest ? { method: method ?? 'merge' } : null,
    checks: (view.statusCheckRollup ?? []).map(parseCheck),
    reviews: (view.latestReviews ?? []).map(
      (r: any): Review => ({
        id: String(r.id ?? r.submittedAt ?? `${login(r.author)}:${r.state}`),
        author: login(r.author),
        state: String(r.state),
        body: String(r.body ?? ''),
      }),
    ),
    comments: (view.comments ?? []).map(
      (c: any): Comment => ({
        author: login(c.author),
        body: String(c.body ?? ''),
        url: String(c.url ?? ''),
        createdAt: String(c.createdAt ?? ''),
        isBot: isBot(login(c.author)),
      }),
    ),
    threads: (pr?.reviewThreads?.nodes ?? [])
      .filter((t: any) => !t.isResolved)
      .map((t: any): Thread => {
        const [first = {}, ...rest] = t.comments?.nodes ?? []
        return {
          id: String(t.id ?? `${t.path}:${t.line}`),
          path: String(t.path ?? ''),
          line: typeof t.line === 'number' ? t.line : null,
          author: login(first.author),
          body: String(first.body ?? ''),
          url: String(first.url ?? ''),
          isOutdated: Boolean(t.isOutdated),
          replies: rest.map((c: any) => ({ author: login(c.author), body: String(c.body ?? '') })),
          commentCount: Number(t.comments?.totalCount ?? rest.length + 1),
        }
      }),
    hasMoreThreads: Boolean(pr?.reviewThreads?.pageInfo?.hasNextPage),
    repo: parseRepoSettings(repoRaw),
    viewer: {
      login: graph?.data?.viewer?.login ?? null,
      canMergeAsAdmin: Boolean(pr?.viewerCanMergeAsAdmin),
      canEnableAutoMerge: Boolean(pr?.viewerCanEnableAutoMerge),
    },
  }
}

export const parseRepoSettings = (raw: any): RepoSettings => ({
  methods: [
    raw.squashMergeAllowed ? 'squash' : null,
    raw.mergeCommitAllowed ? 'merge' : null,
    raw.rebaseMergeAllowed ? 'rebase' : null,
  ].filter((m): m is MergeMethod => m !== null),
  isAutoMergeAllowed: Boolean(raw.autoMergeAllowed),
})

export type HttpReply = { status: number; etag: string | null }

/** The status line and ETag of `gh api -i` output. */
export const parseHttpReply = (text: string): HttpReply => {
  const status = /^HTTP\/[\d.]+\s+(\d{3})/m.exec(text)
  const etag = /^etag:\s*(.+?)\s*$/im.exec(text)
  return { status: status ? Number(status[1]) : 0, etag: etag?.[1] ?? null }
}
