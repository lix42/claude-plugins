import { randomUUID } from 'node:crypto'
import type { Io } from '../../../plugins/pr-panel/hooks/io'
import { actionLabel, fixCheck, fixThread, runAction } from '../../../plugins/pr-panel/hooks/actions'
import { availableActions, effectiveMethod, type ActionId } from '../../../plugins/pr-panel/hooks/derive'
import { extractPrRefs, parsePrArg } from '../../../plugins/pr-panel/hooks/parse'
import { createPoller, findBranchPr, flushAgent, hurry, refresh as refreshPr, tick as poll, track, untrack } from '../../../plugins/pr-panel/hooks/sync'
import type { MergeMethod } from '../../../plugins/pr-panel/types/index.d.ts'
import { checkID, initialState, type FixTarget } from './rpc.ts'

export type PanelHost = {
  run: Io['run']
  changed: () => void
  notify: (text: string, title: string, important: boolean) => Promise<void>
  tellAgent: Io['tellAgent']
}

/** One root session's adapter. Mutable state is private to this factory's closures. */
export function createPanel(host: PanelHost, saved = initialState()) {
  const state = { ...saved, busy: null as string | null, notice: null as typeof saved.notice }
  const poller = createPoller()
  const pending = new Map<string, { url: string; sha: string; method: MergeMethod | null; action: ActionId; expires: number }>()
  let started: Promise<void> | undefined
  let discovering: Promise<void> | undefined
  let ticking: Promise<void> | undefined
  let queued = 0
  let synchronization = Promise.resolve()

  // The shared poller only exposes an in-flight Set. Serialize adapter operations
  // so a confirmed action can wait for polling instead of losing its token.
  const synchronize = <T>(work: () => Promise<T>): Promise<T> => {
    queued++
    const next = synchronization.then(work)
    synchronization = next.then(() => {}, () => {})
    return next.finally(() => { queued-- })
  }
  const change = () => host.changed()
  const io: Io = {
    run: host.run,
    now: async () => Date.now(),
    getPrs: async () => state.prs,
    updatePrs: async fn => { state.prs = fn(state.prs); change(); return state.prs },
    updateSelected: async fn => { const next = fn(state.selected); if (next !== state.selected) { state.selected = next; change() } },
    setBusy: async busy => { if (busy !== state.busy) { state.busy = busy; change() } },
    setMethod: async (url, method) => { if (state.methods[url] !== method) { state.methods[url] = method; change() } },
    toast: text => { void host.notify(text.startsWith('Prompt ready:') ? 'Fix prompt prepared: review the preview before sending' : text, 'Pull request', false).catch(() => {}) },
    notify: (text, title) => host.notify(text, title, true),
    setNotice: async notice => { if (notice !== state.notice) { state.notice = notice; change() } },
    updateNotice: async fn => { const next = fn(state.notice); if (next !== state.notice) { state.notice = next; change() } },
    after: (ms, fn) => { setTimeout(fn, ms) },
    fill: async () => false,
    tellAgent: host.tellAgent,
    getAgent: async () => state.agent,
    setAgent: async agent => { if (state.agent !== agent) { state.agent = agent; change() } },
    openPane: async () => ({ isPlaced: false, reason: 'Open /pr in the terminal' }),
    closePane: async () => {},
  }
  const prune = () => { for (const [token, value] of pending) if (value.expires < Date.now()) pending.delete(token) }
  const selected = () => state.prs.find(pr => pr.ref.url === state.selected) ?? state.prs.at(-1)
  const find = (url: string) => {
    const pr = state.prs.find(pr => pr.ref.url === url)
    if (!pr) throw new Error('PR is no longer tracked')
    return pr
  }
  const discover = () => discovering ??= synchronize(async () => {
    const ref = await findBranchPr(io)
    if (ref) await track(io, poller, [ref])
  }).finally(() => { discovering = undefined })
  const tick = () => {
    if (state.busy) return Promise.resolve()
    return ticking ??= synchronize(async () => { await poll(io, poller); await flushAgent(io, poller) })
      .finally(() => { ticking = undefined })
  }
  const start = () => started ??= state.prs.length ? tick() : discover()

  const command = async (args: string, url?: string) => {
    const arg = args.trim()
    const toggle = /^agent(?:\s+(on|off))?$/.exec(arg)
    if (toggle) {
      if (toggle[1]) await io.setAgent(toggle[1] === 'on')
      return `PR activity messages: ${state.agent ? 'on' : 'off'}.`
    }
    if (arg === 'untrack') {
      if (!url) return 'No PR is selected.'
      if (state.busy) throw new Error('An action is already running')
      const pr = find(url)
      await untrack(io, poller, url)
      return `Stopped tracking #${pr.ref.number}.`
    }
    if (!arg) {
      if (!state.prs.length) await discover()
      return state.prs.length ? 'PR panel opened.' : 'No open PR for this branch. Use /pr <url|number>.'
    }
    return synchronize(async () => {
      const fallback = url ? find(url).ref : selected()?.ref ?? await findBranchPr(io)
      const ref = parsePrArg(arg, fallback)
      if (!ref) throw new Error('Pass a PR URL, or a number with a known repository.')
      await track(io, poller, [ref])
      return `Tracking #${ref.number}.`
    })
  }
  const observe = (command: string, output: string) => synchronize(async () => {
    if (/\bgh\s+pr\s+create\b/.test(command)) {
      const refs = extractPrRefs(output)
      if (!refs.length) { const ref = await findBranchPr(io); if (ref) refs.push(ref) }
      await track(io, poller, refs)
    }
    else if (/\bgit\s+push\b|\bgh\s+pr\s+(merge|ready|close|reopen|edit|review|comment)\b|\bgh\s+run\s+rerun\b/.test(command)) await hurry(io, poller)
  })
  const refresh = (url: string) => synchronize(async () => { await refreshPr(io, poller, find(url).ref, true) })
  const select = async (url: string) => { find(url); await io.updateSelected(() => url) }
  const method = async (url: string, method: MergeMethod) => {
    if (!find(url).snapshot?.repo.methods.includes(method)) throw new Error('Merge method is not allowed')
    await io.setMethod(url, method)
  }
  const prepare = async (action: ActionId, url: string, requestedMethod?: MergeMethod | null) => {
    if (state.busy) throw new Error('An action is already running')
    await refresh(url)
    const pr = find(url)
    if (!pr.snapshot || pr.error) throw new Error(pr.error ?? 'No current PR snapshot')
    if (requestedMethod && !pr.snapshot.repo.methods.includes(requestedMethod)) throw new Error('Merge method is no longer allowed')
    const method = effectiveMethod(pr.snapshot, requestedMethod ?? state.methods[url])
    if (!availableActions(pr.snapshot, method).includes(action)) throw new Error('Action is no longer available')
    prune()
    if (pending.size >= 100) throw new Error('Too many pending confirmations; let them expire before trying again')
    const token = randomUUID()
    pending.set(token, { url, sha: pr.snapshot.headSha, method, action, expires: Date.now() + 60_000 })
    return { token, label: `#${pr.ref.number}: ${actionLabel(action, method)}`, url, sha: pr.snapshot.headSha }
  }
  const action = async (token: string) => {
    prune()
    const confirmation = pending.get(token)
    if (!confirmation) throw new Error('Action expired; choose it again')
    if (state.busy) throw new Error('An action is already running')
    await io.setBusy('Verifying action')
    try {
      await synchronize(async () => {
        prune()
        if (!pending.has(token)) throw new Error('Action expired; choose it again')
        const pr = find(confirmation.url)
        await refreshPr(io, poller, pr.ref, true)
        const current = find(confirmation.url)
        if (!current.snapshot || current.error || current.snapshot.headSha !== confirmation.sha ||
            !availableActions(current.snapshot, confirmation.method).includes(confirmation.action)) {
          throw new Error('PR changed; review its state and choose the action again')
        }
        // Consume only immediately before the mutation, never for a busy poller.
        pending.delete(token)
        await runAction(io, poller, current.ref, current.snapshot, confirmation.action, confirmation.method)
      })
    } finally { await io.setBusy(null) }
  }
  const fix = async (target: FixTarget) => {
    if (state.busy) throw new Error('An action is already running')
    const pr = find(target.url)
    if (!pr.snapshot) throw new Error('PR has no snapshot')
    let draft = ''
    const capture = { ...io, fill: async (text: string) => { draft = text; return true } }
    if (target.kind === 'check') {
      if (pr.snapshot.headSha !== target.headSha) throw new Error('PR head changed; choose the check again')
      const matches = pr.snapshot.checks.filter(check => checkID(check) === target.itemID)
      if (matches.length !== 1 || matches[0].state !== 'fail') throw new Error('Failed check no longer exists or is ambiguous')
      await fixCheck(capture, pr.ref, matches[0])
    } else {
      const thread = pr.snapshot.threads.find(thread => thread.id === target.itemID)
      if (!thread) throw new Error('Thread no longer exists')
      await fixThread(capture, pr.ref, thread)
    }
    return draft
  }
  const active = () => { prune(); return !!state.busy || queued > 0 || pending.size > 0 }
  return { state, poller, io, start, tick, selected, command, observe, refresh, select, method, prepare, action, fix, active }
}

export type Panel = ReturnType<typeof createPanel>
