import type { Check, MergeMethod, PrRef, PrSnapshot, Thread } from '../types'
import { failedRunIds, methodLabel, type ActionId } from './derive'
import { disableAutoArgv, failedLogArgv, mergeArgv, readyArgv, rerunArgv, runGh } from './gh'
import type { Io } from './io'
import { fixCheckPrompt, fixThreadPrompt } from './prompts'
import { refresh, type Poller } from './sync'

const withBusy = async (io: Io, label: string, work: () => Promise<void>) => {
  await io.setBusy(label)
  try {
    await work()
  } finally {
    await io.setBusy(null)
  }
}

/** The first meaningful line of gh's stderr, without its leading mark. */
export const errorLine = (error: string): string =>
  error
    .split('\n')
    .map(line => line.replace(/^[X!✗]\s+/, '').trim())
    .find(Boolean) ?? 'unknown error'

const report = async (io: Io, ref: PrRef, label: string, result: { isOk: boolean; error: string }) => {
  const text = result.isOk ? `${label}: done` : `${label} failed: ${errorLine(result.error)}`
  io.toast(text)
  await io.setNotice({ url: ref.url, text, isError: !result.isOk })
}

export const actionLabel = (action: ActionId, method: MergeMethod | null): string => {
  const how = method ? ` (${methodLabel(method)})` : ''
  switch (action) {
    case 'auto-enable':
      return `Enable auto-merge${how}`
    case 'auto-disable':
      return 'Disable auto-merge'
    case 'merge':
      return method === 'squash' ? 'Squash and merge' : method === 'rebase' ? 'Rebase and merge' : 'Merge'
    case 'bypass':
      return `Bypass rules and ${method === 'squash' ? 'squash and merge' : method === 'rebase' ? 'rebase and merge' : 'merge'}`
    case 'ready':
      return 'Ready for review'
    case 'rerun':
      return 'Re-run failed'
  }
}

export const runAction = async (
  io: Io,
  poller: Poller,
  ref: PrRef,
  snapshot: PrSnapshot,
  action: ActionId,
  method: MergeMethod | null,
) => {
  const label = `#${ref.number} ${actionLabel(action, method)}`
  await io.setNotice(null)

  await withBusy(io, label, async () => {
    if (action === 'rerun') {
      const results = await Promise.all(failedRunIds(snapshot.checks).map(id => runGh(io, rerunArgv(ref, id))))
      const failed = results.find(r => !r.isOk)
      await report(io, ref, label, failed ?? { isOk: true, error: '' })
    } else {
      const argv =
        action === 'auto-disable'
          ? disableAutoArgv(ref)
          : action === 'ready'
            ? readyArgv(ref)
            : mergeArgv(ref, method ?? 'merge', action === 'auto-enable' ? 'auto' : action === 'bypass' ? 'admin' : 'now')
      await report(io, ref, label, await runGh(io, argv, 60_000))
    }
    await refresh(io, poller, ref, true)
  })
}

const fill = async (io: Io, text: string) => {
  const isFilled = await io.fill(text)
  io.toast(isFilled ? 'Prompt ready: review it and press Enter' : 'Could not fill the prompt box')
}

export const fixCheck = async (io: Io, ref: PrRef, check: Check) => {
  await withBusy(io, `Fetching log for ${check.name}`, async () => {
    const log = check.runId ? await runGh(io, failedLogArgv(ref, check.runId), 60_000) : null
    await fill(io, fixCheckPrompt(ref, check, log?.isOk ? log.stdout : null))
  })
}

export const fixThread = (io: Io, ref: PrRef, thread: Thread) => fill(io, fixThreadPrompt(ref, thread))
