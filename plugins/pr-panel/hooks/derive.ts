import type { Check, MergeMethod, PrSnapshot, TrackedPr } from '../types'

export const FAST_POLL_MS = 15_000
export const IDLE_POLL_MS = 60_000
/** Probes miss thread resolutions, so a full fetch runs at least this often. */
export const FULL_REFRESH_MS = 5 * 60_000
/** How long a merged or closed PR stays on screen before it is untracked. */
export const LINGER_MS = 2 * 60_000

const METHOD_ORDER: MergeMethod[] = ['squash', 'merge', 'rebase']

export type CheckCounts = { pass: number; fail: number; pending: number; skipped: number; total: number }

export const countChecks = (checks: readonly Check[]): CheckCounts => {
  const counts = { pass: 0, fail: 0, pending: 0, skipped: 0, total: checks.length }
  for (const check of checks) counts[check.state] += 1
  return counts
}

export const isOpen = (snapshot: PrSnapshot | null) => snapshot === null || snapshot.state === 'OPEN'

/** How long until this PR is worth asking about again; null once it is merged or closed. */
export const pollIntervalMs = (snapshot: PrSnapshot | null): number | null => {
  if (snapshot === null) return FAST_POLL_MS
  if (snapshot.state !== 'OPEN') return null
  const isMoving =
    countChecks(snapshot.checks).pending > 0 ||
    snapshot.mergeStateStatus === 'UNKNOWN' ||
    snapshot.autoMerge !== null
  return isMoving ? FAST_POLL_MS : IDLE_POLL_MS
}

export const defaultMethod = (allowed: readonly MergeMethod[]): MergeMethod | null =>
  METHOD_ORDER.find(m => allowed.includes(m)) ?? null

/** The picked method if the repo still allows it, else the repo's default. */
export const effectiveMethod = (snapshot: PrSnapshot, picked: MergeMethod | undefined): MergeMethod | null =>
  picked && snapshot.repo.methods.includes(picked) ? picked : defaultMethod(snapshot.repo.methods)

export type ActionId = 'auto-enable' | 'auto-disable' | 'merge' | 'bypass' | 'ready' | 'rerun'

/** Actions that ask for a second press before they run. */
export const CONFIRMED_ACTIONS: readonly ActionId[] = ['merge', 'bypass']

/** Merge states GitHub would merge as they stand (UNSTABLE: only non-required checks failing). */
const MERGEABLE_STATES = new Set(['CLEAN', 'UNSTABLE', 'HAS_HOOKS'])

/** Only actions GitHub would accept now: a blocked merge is not offered, a bypass is where allowed. */
export const availableActions = (snapshot: PrSnapshot, method: MergeMethod | null): ActionId[] => {
  if (snapshot.state !== 'OPEN') return []
  const actions: ActionId[] = []
  const isConflicting = snapshot.mergeable === 'CONFLICTING'
  if (snapshot.isDraft) actions.push('ready')
  const canMergeNow = MERGEABLE_STATES.has(snapshot.mergeStateStatus)
  if (snapshot.autoMerge) actions.push('auto-disable')
  // Auto-merge on a PR that could merge now would merge it at once, unconfirmed: offer Merge instead.
  else if (method && snapshot.viewer.canEnableAutoMerge && !snapshot.isDraft && !canMergeNow) actions.push('auto-enable')
  if (method && !snapshot.isDraft && !isConflicting) {
    if (canMergeNow) actions.push('merge')
    else if (snapshot.mergeStateStatus === 'BLOCKED' && snapshot.viewer.canMergeAsAdmin) actions.push('bypass')
  }
  if (failedRunIds(snapshot.checks).length > 0) actions.push('rerun')
  return actions
}

/** Why a merge cannot go ahead as things stand; empty when it can. */
export const mergeBlockers = (snapshot: PrSnapshot): string[] => {
  if (snapshot.state !== 'OPEN') return []
  if (snapshot.isDraft) return ['the PR is a draft']
  if (snapshot.mergeable === 'CONFLICTING') return [`conflicts with ${snapshot.baseRefName}`]
  switch (snapshot.mergeStateStatus) {
    case 'BEHIND':
      return [`the branch is behind ${snapshot.baseRefName}`]
    case 'UNKNOWN':
      return ['GitHub is still computing mergeability']
    case 'BLOCKED': {
      const c = countChecks(snapshot.checks)
      const reasons = [
        snapshot.threads.length ? `${snapshot.threads.length} unresolved thread${snapshot.threads.length === 1 ? '' : 's'}` : '',
        snapshot.reviewDecision === 'REVIEW_REQUIRED' ? 'a review is required' : '',
        snapshot.reviewDecision === 'CHANGES_REQUESTED' ? 'changes were requested' : '',
        c.fail ? `${c.fail} failing check${c.fail === 1 ? '' : 's'}` : '',
        c.pending ? `${c.pending} pending check${c.pending === 1 ? '' : 's'}` : '',
      ].filter(Boolean)
      return reasons.length ? reasons : ['branch protection rules']
    }
    default:
      return []
  }
}

/** Runs with a failed job and none still going: GitHub refuses to re-run an active run. */
export const failedRunIds = (checks: readonly Check[]): string[] => {
  const active = new Set(checks.filter(c => c.state === 'pending' && c.runId).map(c => c.runId))
  return [...new Set(checks.filter(c => c.state === 'fail' && c.runId && !active.has(c.runId)).map(c => c.runId as string))]
}

const METHOD_LABEL: Record<MergeMethod, string> = { squash: 'squash', merge: 'merge commit', rebase: 'rebase' }
export const methodLabel = (method: MergeMethod) => METHOD_LABEL[method]

/** `#42 ✓5 ✗1 …2 · 2 unresolved · auto-merge: squash` */
export const summaryLine = (pr: TrackedPr): string => {
  const head = `#${pr.ref.number}`
  const s = pr.snapshot
  if (!s) return pr.error ? `${head} error: ${pr.error.split('\n')[0]}` : `${head} loading…`
  if (s.state === 'MERGED') return `${head} merged`
  if (s.state === 'CLOSED') return `${head} closed`

  const parts: string[] = []
  if (s.isDraft) parts.push('draft')
  const c = countChecks(s.checks)
  if (c.total > 0) {
    const marks = [`✓${c.pass}`, c.fail ? `✗${c.fail}` : '', c.pending ? `…${c.pending}` : ''].filter(Boolean)
    parts.push(marks.join(' '))
  }
  if (s.reviewDecision === 'APPROVED') parts.push('approved')
  if (s.reviewDecision === 'CHANGES_REQUESTED') parts.push('changes requested')
  if (s.threads.length) parts.push(`${s.threads.length} unresolved`)
  if (s.mergeable === 'CONFLICTING') parts.push('conflicts')
  if (s.autoMerge) parts.push(`auto-merge: ${methodLabel(s.autoMerge.method)}`)
  return [head, ...parts].join(' · ')
}

export type Change = { text: string; isImportant: boolean }

/** What changed between two fetches that the person would want to hear about. */
export const diffSnapshots = (number: number, prev: PrSnapshot, next: PrSnapshot): Change[] => {
  const changes: Change[] = []
  const at = `#${number}`

  if (prev.state !== next.state) {
    changes.push({ text: `${at} ${next.state.toLowerCase()}`, isImportant: true })
    return changes
  }

  const before = countChecks(prev.checks)
  const after = countChecks(next.checks)
  const isSameHead = prev.headSha === next.headSha
  // Checks can go from not yet registered straight to finished between two fetches.
  if (after.total > 0 && after.pending === 0 && (before.pending > 0 || before.total === 0 || !isSameHead)) {
    changes.push(
      after.fail > 0
        ? { text: `${at}: ${after.fail} check${after.fail === 1 ? '' : 's'} failed`, isImportant: true }
        : { text: `${at}: all checks passed`, isImportant: true },
    )
  }

  const seen = new Set(prev.reviews.map(r => r.id))
  for (const review of next.reviews) {
    if (!seen.has(review.id) && review.state !== 'PENDING') {
      changes.push({ text: `${at}: ${review.author} ${review.state.toLowerCase().replace('_', ' ')}`, isImportant: true })
    }
  }

  const fresh = next.comments.filter(c => !c.isBot).length - prev.comments.filter(c => !c.isBot).length
  if (fresh > 0) changes.push({ text: `${at}: ${fresh} new comment${fresh === 1 ? '' : 's'}`, isImportant: false })

  const known = new Set(prev.threads.map(t => t.id))
  const added = next.threads.filter(t => !known.has(t.id)).length
  if (added > 0) {
    changes.push({ text: `${at}: ${added} new unresolved thread${added === 1 ? '' : 's'}`, isImportant: false })
  }

  if (!prev.autoMerge !== !next.autoMerge) {
    changes.push({ text: `${at}: auto-merge ${next.autoMerge ? 'enabled' : 'disabled'}`, isImportant: false })
  }

  return changes
}
