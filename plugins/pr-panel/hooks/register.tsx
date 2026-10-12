import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { fixCheck, fixThread, runAction } from './actions'
import { CONFIRMED_ACTIONS, effectiveMethod, type ActionId } from './derive'
import type { Io } from './io'
import type { MergeMethod, Notice, TrackedPr } from '../types'
import { extractPrRefs, parsePrArg } from './parse'
import { createPoller, findBranchPr, hurry, refresh, tick, track, untrack, type Poller } from './sync'
import { renderBand, renderPane, type PaneState } from './view'

const PANE = 'pr-panel'
const TICK_MS = 5_000
const CREATES_PR = /\bgh\s+pr\s+create\b/
const MOVES_PR = /\bgit\s+push\b|\bgh\s+pr\s+(merge|ready|close|reopen|edit|review|comment)\b|\bgh\s+run\s+rerun\b/

// Atoms live here: the engine reads which state a module touches from the file that spells `$`.
const prs = atom({ plugin: 'pr-panel', key: 'prs' } as const, [] as TrackedPr[])
const selected = atom({ plugin: 'pr-panel', key: 'selected' } as const, null as string | null)
const methods = atom({ plugin: 'pr-panel', key: 'methods' } as const, {} as Record<string, MergeMethod>)
const busy = atom({ plugin: 'pr-panel', key: 'busy' } as const, null as string | null)
const expanded = atom({ plugin: 'pr-panel', key: 'expanded' } as const, [] as string[])
const confirming = atom({ plugin: 'pr-panel', key: 'confirming' } as const, null as string | null)
const notice = atom({ plugin: 'pr-panel', key: 'notice' } as const, null as Notice | null)

/** The one place `$` is turned into what the rest of the plugin uses. */
function makeIo($: EngineInterface): Io {
  return {
    run: (argv, timeoutMs) => $.process.run(argv, { timeoutMs }),
    now: () => $.clock.now(),
    getPrs: () => read($, prs),
    updatePrs: fn => update($, prs, fn),
    updateSelected: fn => update($, selected, fn),
    setBusy: label => update($, busy, () => label),
    setMethod: (url, method) => update($, methods, all => ({ ...all, [url]: method })),
    toast: text => $.ui.toast(text),
    notify: (text, title) => $.ui.notify(text, { title }),
    setNotice: value => update($, notice, () => value),
    fill: async text => (await $.prompt.fill({ text })).isFilled,
    openPane: () => $.ui.open({ id: PANE, title: 'PRs' }),
    closePane: () => $.ui.close({ id: PANE }),
  }
}

const selectedPr = async (io: Io, url: string | null) => {
  const list = await io.getPrs()
  return list.find(pr => pr.ref.url === url) ?? list.at(-1) ?? null
}

const runCommand = async (io: Io, poller: Poller, current: string | null, args: string) => {
  const arg = args.trim()

  if (arg === 'untrack') {
    const pr = await selectedPr(io, current)
    if (!pr) return 'No PR is tracked.'
    await untrack(io, poller, pr.ref.url)
    return `Stopped tracking #${pr.ref.number}.`
  }

  if (arg === '') {
    if ((await io.getPrs()).length === 0) {
      const branchPr = await findBranchPr(io)
      if (!branchPr) return 'No open PR for this branch. Run /pr <url|number> to track one.'
      await track(io, poller, [branchPr])
    }
    const opened = await io.openPane()
    return opened.isPlaced ? 'PR panel opened.' : `PR panel is open but waits undrawn: ${opened.reason}`
  }

  const fallback = (await selectedPr(io, current))?.ref ?? (await findBranchPr(io))
  const ref = parsePrArg(arg, fallback)
  if (!ref) return `Could not read "${arg}" as a PR. Pass a PR URL, or a number once a PR of the repo is tracked.`
  await track(io, poller, [ref])
  return `Tracking #${ref.number}.`
}

export const register: Register = on => {
  const poller = createPoller()

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const io = makeIo($)
    await $.command.register({
      name: 'pr',
      description: 'Show the PR panel, track a PR (/pr <url|number>), or stop tracking the shown one (/pr untrack)',
      argumentHint: '[url|number|untrack]',
    })
    $.clock.every(TICK_MS, () => void tick(io, poller))
    void findBranchPr(io).then(ref => (ref ? track(io, poller, [ref]) : undefined))
    return started
  })

  on('command.run', { command: 'pr' }, async ($, e) => ({
    text: await runCommand(makeIo($), poller, await read($, selected), e.args),
  })).catch(() => ({ text: 'pr-panel: /pr failed; see the debug log.' }))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    if (CREATES_PR.test(e.command)) {
      void track(makeIo($), poller, extractPrRefs(ran.text ?? ''))
    } else if (MOVES_PR.test(e.command)) {
      void hurry(makeIo($), poller)
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, prs)
    if (e.props.hasSurvey || list.length === 0) return next(e)
    return renderBand($.ui.resolve(e), list, e.props.maxRows)
  })

  // Says in the transcript (not to the model) who closed the pane, so a pane that vanished can be told apart.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) $.ui.log(`pr-panel: pane closed by ${e.origin.kind}; /pr reopens it`)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const io = makeIo($)
    const list = await read($, prs)
    const url = await read($, selected)
    const pr = list.find(item => item.ref.url === url) ?? list.at(-1) ?? null
    const picked = await read($, methods)
    const method = pr?.snapshot ? effectiveMethod(pr.snapshot, picked[pr.ref.url]) : null

    const pending = await read($, confirming)
    const lastNotice = await read($, notice)
    const state: PaneState = {
      method,
      busy: await read($, busy),
      expanded: await read($, expanded),
      confirming: pr && pending?.startsWith(`${pr.ref.url}#`) ? (pending.slice(pr.ref.url.length + 1) as ActionId) : null,
      notice: lastNotice?.url === pr?.ref.url ? lastNotice : null,
    }

    return renderPane($.ui.resolve(e), list, pr, state, {
      select: next => void io.updateSelected(() => next),
      refresh: () => void (pr && refresh(io, poller, pr.ref, true)),
      untrack: () => void (pr && untrack(io, poller, pr.ref.url)),
      pickMethod: value => void (pr && io.setMethod(pr.ref.url, value)),
      act: action => {
        if (!pr?.snapshot) return
        const key = `${pr.ref.url}#${action}`
        // A merge asks for a second press, drawn in the pane, before it runs.
        if (CONFIRMED_ACTIONS.includes(action) && pending !== key) {
          void update($, confirming, () => key)
          return
        }
        void update($, confirming, () => null)
        void runAction(io, poller, pr.ref, pr.snapshot, action, method)
      },
      cancel: () => void update($, confirming, () => null),
      dismissNotice: () => void io.setNotice(null),
      fixCheck: check => void (pr && fixCheck(io, pr.ref, check)),
      fixThread: thread => void (pr && fixThread(io, pr.ref, thread)),
      toggleThread: id =>
        void update($, expanded, ids => (ids.includes(id) ? ids.filter(one => one !== id) : [...ids, id])),
    })
  })
}
