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

const report = (io: Io, label: string, result: { isOk: boolean; error: string }) =>
  io.toast(result.isOk ? `${label}: done` : `${label} failed: ${result.error.split('\n')[0]}`)

export const actionLabel = (action: ActionId, method: MergeMethod | null): string => {
  const how = method ? ` (${methodLabel(method)})` : ''
  switch (action) {
    case 'auto-enable':
      return `Enable auto-merge${how}`
    case 'auto-disable':
      return 'Disable auto-merge'
    case 'merge':
      return method === 'squash' ? 'Squash and merge' : method === 'rebase' ? 'Rebase and merge' : 'Merge'
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

  if (action === 'merge') {
    const answer = await io
      .ask(`${actionLabel(action, method)} PR #${ref.number} now?`, ['Merge', 'Cancel'])
      .catch(() => 'Cancel')
    if (answer !== 'Merge') return
  }

  await withBusy(io, label, async () => {
    if (action === 'rerun') {
      const results = await Promise.all(failedRunIds(snapshot.checks).map(id => runGh(io, rerunArgv(ref, id))))
      const failed = results.find(r => !r.isOk)
      report(io, label, failed ?? { isOk: true, error: '' })
    } else {
      const argv =
        action === 'auto-disable'
          ? disableAutoArgv(ref)
          : action === 'ready'
            ? readyArgv(ref)
            : mergeArgv(ref, method ?? 'merge', action === 'auto-enable')
      report(io, label, await runGh(io, argv, 60_000))
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
