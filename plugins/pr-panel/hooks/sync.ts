import type { PrRef, PrSnapshot, TrackedPr } from '../types'
import { FAST_POLL_MS, FULL_REFRESH_MS, IDLE_POLL_MS, LINGER_MS, diffSnapshots, pollIntervalMs } from './derive'
import { currentBranchPrArgv, probeArgv, probePaths, prViewArgv, runGh, threadsArgv } from './gh'
import type { Io } from './io'
import { extractPrRefs, parseHttpReply, parseSnapshot } from './parse'

/** Module-local polling bookkeeping; a reload starts it over with a full fetch. */
export type Poller = {
  etags: Map<string, string>
  due: Map<string, number>
  lastFull: Map<string, number>
  inFlight: Set<string>
}

export const createPoller = (): Poller => ({
  etags: new Map(),
  due: new Map(),
  lastFull: new Map(),
  inFlight: new Set(),
})

const patch = (io: Io, url: string, fn: (pr: TrackedPr) => TrackedPr) =>
  io.updatePrs(list => list.map(pr => (pr.ref.url === url ? fn(pr) : pr)))

/** Adds PRs not yet tracked, selects the newest, opens the pane, and fetches them. */
export const track = async (io: Io, poller: Poller, refs: readonly PrRef[]) => {
  if (refs.length === 0) return
  const known = new Set((await io.getPrs()).map(pr => pr.ref.url))
  const added = refs.filter(ref => !known.has(ref.url))
  if (added.length > 0) {
    // Checked again inside the update: another track of the same URL may have landed meanwhile.
    await io.updatePrs(list => {
      const present = new Set(list.map(pr => pr.ref.url))
      const fresh = added.filter(ref => !present.has(ref.url))
      return [...list, ...fresh.map((ref): TrackedPr => ({ ref, snapshot: null, error: null, fetchedAt: 0, endedAt: null }))]
    })
    await io.updateSelected(() => added.at(-1)?.url ?? null)
  }
  void io.openPane()
  await Promise.all(refs.map(ref => refresh(io, poller, ref, true)))
}

export const untrack = async (io: Io, poller: Poller, url: string) => {
  poller.due.delete(url)
  poller.lastFull.delete(url)
  const rest = await io.updatePrs(list => list.filter(pr => pr.ref.url !== url))
  await io.updateSelected(current => (current === url ? (rest.at(-1)?.ref.url ?? null) : current))
  if (rest.length === 0) await io.closePane()
}

/** The open PR of the session's current branch, if any. */
export const findBranchPr = async (io: Io): Promise<PrRef | null> => {
  const result = await runGh(io, currentBranchPrArgv())
  if (!result.isOk) return null
  try {
    const { url, state } = JSON.parse(result.stdout)
    return state === 'OPEN' ? (extractPrRefs(String(url))[0] ?? null) : null
  } catch {
    return null
  }
}

/** Conditional GETs on `paths`, storing new ETags; true when any of them changed. */
const probeChanged = async (io: Io, poller: Poller, ref: PrRef, paths: readonly string[]) => {
  const replies = await Promise.all(
    paths.map(async path => {
      const key = `${ref.host}/${path}`
      const result = await runGh(io, probeArgv(ref, path, poller.etags.get(key) ?? null))
      const reply = parseHttpReply(result.stdout)
      if (reply.status === 200 && reply.etag) poller.etags.set(key, reply.etag)
      return reply.status
    }),
  )
  return replies.some(status => status !== 304)
}

/** A snapshot, with `warning` when the GraphQL half failed and stale threads/settings stand in. */
type Fetched = { snapshot: PrSnapshot; warning: string | null; error?: undefined } | { error: string; snapshot?: undefined }

const fullFetch = async (io: Io, ref: PrRef, prev: PrSnapshot | null): Promise<Fetched> => {
  const [view, graph] = await Promise.all([runGh(io, prViewArgv(ref)), runGh(io, threadsArgv(ref))])
  if (!view.isOk) return { error: view.error }
  try {
    const parsed = parseSnapshot(JSON.parse(view.stdout), graph.isOk ? JSON.parse(graph.stdout) : null)
    if (graph.isOk) return { snapshot: parsed, warning: null }
    // A failed GraphQL call keeps what we knew of threads and settings, and says so.
    const kept = prev ? { ...parsed, threads: prev.threads, hasMoreThreads: prev.hasMoreThreads, repo: prev.repo, viewer: prev.viewer } : parsed
    return { snapshot: kept, warning: `review threads and merge settings may be stale: ${graph.error.split('\n')[0]}` }
  } catch (error) {
    return { error: `could not read gh output: ${error instanceof Error ? error.message : String(error)}` }
  }
}

const announce = async (io: Io, ref: PrRef, prev: PrSnapshot, next: PrSnapshot) => {
  const changes = diffSnapshots(ref.number, prev, next)
  if (changes.length === 0) return
  io.toast(changes.map(c => c.text).join('\n'))
  const important = changes.filter(c => c.isImportant)
  if (important.length > 0) {
    await io.notify(important.map(c => c.text).join('\n'), next.title || 'Pull request').catch(() => {})
  }
}

/** Brings one PR up to date: probes first, and fetches in full only when something moved. */
export const refresh = async (io: Io, poller: Poller, ref: PrRef, force = false) => {
  if (poller.inFlight.has(ref.url)) return
  poller.inFlight.add(ref.url)
  try {
    const now = await io.now()
    const prev = (await io.getPrs()).find(pr => pr.ref.url === ref.url)?.snapshot ?? null
    const changed = await probeChanged(io, poller, ref, probePaths(ref, prev?.headSha ?? null))
    const isStale = now - (poller.lastFull.get(ref.url) ?? 0) >= FULL_REFRESH_MS

    if (!force && !changed && !isStale && prev) {
      poller.due.set(ref.url, now + (pollIntervalMs(prev) ?? Infinity))
      return
    }

    const fetched = await fullFetch(io, ref, prev)
    if (fetched.error !== undefined) {
      const error = fetched.error
      await patch(io, ref.url, pr => ({ ...pr, error, fetchedAt: now }))
      poller.due.set(ref.url, now + IDLE_POLL_MS)
      return
    }

    const next = fetched.snapshot
    const warning = fetched.warning
    if (next.headSha && next.headSha !== prev?.headSha) {
      // A new head has checks we hold no ETags for yet; take them now so the next probe can match.
      await probeChanged(io, poller, ref, probePaths(ref, next.headSha).slice(1))
    }
    // A partial fetch is not counted as full, so the next poll fetches again.
    if (warning) poller.lastFull.delete(ref.url)
    else poller.lastFull.set(ref.url, now)
    poller.due.set(ref.url, now + (warning ? FAST_POLL_MS : (pollIntervalMs(next) ?? Infinity)))
    const isEnded = next.state !== 'OPEN'
    await patch(io, ref.url, pr => ({
      ...pr,
      snapshot: next,
      error: warning,
      fetchedAt: now,
      endedAt: isEnded ? (pr.endedAt ?? now) : null,
    }))
    if (prev) await announce(io, ref, prev, next)
  } finally {
    poller.inFlight.delete(ref.url)
  }
}

/** Refreshes every tracked PR whose turn has come, and drops merged or closed ones past their linger. */
export const tick = async (io: Io, poller: Poller) => {
  const now = await io.now()
  const list = await io.getPrs()
  await Promise.all(
    list.filter(pr => (poller.due.get(pr.ref.url) ?? 0) <= now).map(pr => refresh(io, poller, pr.ref)),
  )
  for (const pr of list) {
    if (pr.endedAt !== null && now - pr.endedAt >= LINGER_MS) await untrack(io, poller, pr.ref.url)
  }
}

/** Makes every PR that can still change due now, as after a push or a reopen; only a merge is final. */
export const hurry = async (io: Io, poller: Poller) => {
  for (const pr of await io.getPrs()) {
    if (pr.snapshot?.state !== 'MERGED') poller.due.set(pr.ref.url, 0)
  }
  await tick(io, poller)
}
