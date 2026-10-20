import { Plugin } from '@opencode/plugin/tui'
import type { PanelInput } from '@opencode/plugin/tui/context'
import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js'
import type { JSX } from '@opentui/solid'
import { actionLabel } from '../../../plugins/pr-panel/hooks/actions'
import { availableActions, effectiveMethod, mergeBlockers, summaryLine, type ActionId } from '../../../plugins/pr-panel/hooks/derive'
import type { MergeMethod } from '../../../plugins/pr-panel/types/index.d.ts'
import { checkID, PanelRpc, type FixTarget, type PanelState } from './rpc.ts'

const PANEL = 'lix42.pr-panel'

export default Plugin.define({
  id: 'lix42.tui',
  setup(ctx) {
    if (ctx.options.prPanel === false) return
    const rpc = ctx.client.rpc(PanelRpc)
    const [states, setStates] = createSignal<Record<string, PanelState>>({})
    const [enabled, setEnabled] = createSignal<Record<string, boolean>>({})
    const watched = new Map<string, number>()
    const inFlight = new Map<string, Promise<void>>()
    const dirty = new Set<string>()
    let disposed = false
    const fail = (error: unknown) => {
      if (!disposed) ctx.ui.toast.show({ title: 'PR panel', message: error instanceof Error ? error.message : String(error), variant: 'error' })
    }
    const location = (sessionID: string) => ({ location: ctx.data.session.get(sessionID)?.location ?? ctx.location ?? ctx.data.location.default() })

    const load = (sessionID: string): Promise<void> => {
      const pending = inFlight.get(sessionID)
      if (pending) { dirty.add(sessionID); return pending }
      const work = (async () => {
        do {
          dirty.delete(sessionID)
          const status = await rpc.status({}, location(sessionID)) as { enabled: boolean }
          if (!disposed) setEnabled(all => ({ ...all, [sessionID]: status.enabled }))
          if (!status.enabled) {
            if (!disposed) setStates(all => { const next = { ...all }; delete next[sessionID]; return next })
            return
          }
          const state = await rpc.state({ sessionID }, location(sessionID)) as PanelState
          if (!disposed && !dirty.has(sessionID)) setStates(all => ({ ...all, [sessionID]: state }))
        } while (!disposed && dirty.has(sessionID))
      })().finally(() => inFlight.delete(sessionID))
      inFlight.set(sessionID, work)
      return work
    }
    const watch = (sessionID: string) => {
      if (ctx.data.session.get(sessionID)?.parentID) return
      watched.set(sessionID, (watched.get(sessionID) ?? 0) + 1)
      // Background health/recovery must not generate periodic error toasts.
      void load(sessionID).catch(() => {})
      onCleanup(() => {
        const count = (watched.get(sessionID) ?? 1) - 1
        if (count) watched.set(sessionID, count)
        else watched.delete(sessionID)
      })
    }
    const safely = (work: () => Promise<unknown>) => { void work().catch(fail) }
    const currentSession = () => {
      const route = ctx.ui.router.current()
      if (route.type !== 'session') throw new Error('Open a session first')
      return route.sessionID
    }

    const stops = [
      rpc.events.on('updated', event => {
        const { sessionID, state } = event.data as { sessionID: string; state: PanelState }
        if (watched.has(sessionID)) {
          if (inFlight.has(sessionID)) dirty.add(sessionID)
          setStates(all => ({ ...all, [sessionID]: state }))
        }
      }),
      rpc.events.on('notice', async event => {
        const notice = event.data as { sessionID: string; text: string; title: string; important: boolean }
        ctx.ui.toast.show({ sessionID: notice.sessionID, message: notice.text, title: notice.title })
        if (notice.important) await ctx.attention.notify({ title: notice.title, message: notice.text, notification: { when: 'blurred' } })
      }),
    ]

    const execute = async (sessionID: string, url: string, method: MergeMethod | null, action: ActionId) => {
      const prepared = await rpc.prepare({ sessionID, url, method, action }, location(sessionID)) as { token: string; label: string; url: string; sha: string }
      // Confirm every mutation, including auto-merge, which may merge immediately.
      const confirmed = await ctx.ui.dialog.confirm({
        title: prepared.label,
        message: `${prepared.url}\nHead: ${prepared.sha.slice(0, 12)}\n${action === 'bypass' ? 'This bypasses repository protection rules.\n' : ''}Run this GitHub action?`,
        label: { confirm: 'Run', cancel: 'Cancel' },
      })
      if (confirmed) await rpc.action({ sessionID, token: prepared.token }, location(sessionID))
      await load(sessionID)
    }

    const fix = async (sessionID: string, target: FixTarget) => {
      const result = await rpc.fix({ sessionID, target }, location(sessionID)) as { text: string }
      const text = await ctx.ui.dialog.prompt({ title: 'Review and edit the Fix prompt', value: result.text, description: 'Nothing is sent until you confirm Send.' })
      if (!text?.trim()) return
      if (await ctx.ui.dialog.confirm({ title: 'Send Fix prompt?', message: text, label: { confirm: 'Send', cancel: 'Cancel' } })) {
        await ctx.client.session.prompt({ sessionID, text, delivery: 'queue' })
      }
    }

    function Button(props: { children: JSX.Element; run: () => void }) {
      return <text fg={ctx.theme.text.accent} onMouseDown={props.run}>{props.children}</text>
    }

    function Band(props: { sessionID: string }) {
      createEffect(() => watch(props.sessionID))
      return <box flexDirection="column">
        <For each={states()[props.sessionID]?.prs.slice(-3)}>{pr =>
          <text fg={ctx.theme.text.muted} onMouseDown={() => ctx.ui.panel.open(PANEL)}>{summaryLine(pr)} · /pr</text>
        }</For>
      </box>
    }

    function PanelView(props: { panel: PanelInput }) {
      createEffect(() => watch(props.panel.sessionID))
      const sessionID = () => props.panel.sessionID
      const state = () => states()[sessionID()]
      const pr = () => state()?.prs.find(item => item.ref.url === state()?.selected) ?? state()?.prs.at(-1)
      const snapshot = () => pr()?.snapshot
      const method = () => snapshot() ? effectiveMethod(snapshot()!, state()?.methods[pr()!.ref.url]) : null
      const acts = () => snapshot() ? availableActions(snapshot()!, method()) : []
      const [expanded, setExpanded] = createSignal<string[]>([])
      const refresh = () => {
        const owner = sessionID(), url = pr()?.ref.url
        if (url) safely(async () => { await rpc.refresh({ sessionID: owner, url }, location(owner)); await load(owner) })
      }
      const untrack = () => {
        const owner = sessionID(), url = pr()?.ref.url
        if (url) safely(async () => { await rpc.command({ sessionID: owner, args: 'untrack', url }, location(owner)); await load(owner) })
      }
      const select = (url: string) => safely(async () => { await rpc.select({ sessionID: sessionID(), url }, location(sessionID())); await load(sessionID()) })
      const pickMethod = () => safely(async () => {
        const owner = sessionID(), url = pr()?.ref.url
        if (!url) return
        const selected = await ctx.ui.dialog.select<MergeMethod>({
          title: 'Merge method', current: method() ?? undefined,
          options: (snapshot()?.repo.methods ?? []).map(value => ({ title: value, value })),
        })
        if (selected) { await rpc.method({ sessionID: owner, url, method: selected }, location(owner)); await load(owner) }
      })
      const doAction = (action: ActionId) => {
        const owner = sessionID(), url = pr()?.ref.url, selectedMethod = method()
        if (url) safely(() => execute(owner, url, selectedMethod, action))
      }
      const chooseFix = () => safely(async () => {
        const owner = sessionID()
        const displayed = pr()
        const s = displayed?.snapshot
        if (!s) return
        const url = displayed.ref.url
        const value = await ctx.ui.dialog.select<FixTarget>({
          title: 'Fix check or review thread',
          options: [
            ...s.checks.flatMap(check => check.state === 'fail' ? [{ title: check.name, value: { url, kind: 'check' as const, itemID: checkID(check), headSha: s.headSha }, category: 'Failed checks' }] : []),
            ...s.threads.map(thread => ({ title: `${thread.path}:${thread.line ?? '?'} — ${thread.author}`, value: { url, kind: 'thread' as const, itemID: thread.id }, category: 'Review threads' })),
          ],
        })
        if (value) await fix(owner, value)
      })
      const hotkey: Record<ActionId, string> = { 'auto-enable': 'a', 'auto-disable': 'a', merge: 'm', bypass: 'b', ready: 'd', rerun: 'x' }
      ctx.keymap.layer(() => ({
        enabled: () => props.panel.focused,
        commands: [
          { title: 'Refresh', bind: 'r', run: refresh },
          { title: 'Untrack', bind: 'u', run: untrack },
          { title: 'Fix', bind: 'f', run: chooseFix },
          { title: 'Merge method', bind: 's', run: pickMethod },
          { title: 'Fullscreen', bind: 'v', run: props.panel.toggleFullscreen },
          ...acts().map(action => ({ title: actionLabel(action, method()), bind: hotkey[action], run: () => doAction(action) })),
          ...(state()?.prs.slice(0, 9) ?? []).map((item, index) => ({ bind: String(index + 1), title: `PR #${item.ref.number}`, run: () => select(item.ref.url) })),
        ],
      }))
      return <box flexDirection="column" height="100%" padding={1}>
        <text fg={ctx.theme.text.base}>Pull requests · r refresh · u untrack · f fix · s method · v fullscreen</text>
        <box flexDirection="row" gap={1}>
          <For each={state()?.prs}>{(item, index) => <Button run={() => select(item.ref.url)}>{`${index() + 1}: #${item.ref.number}${item.ref.url === pr()?.ref.url ? ' *' : ''}`}</Button>}</For>
        </box>
        <Show when={pr()} fallback={<text>No tracked PRs. Use /pr &lt;url|number&gt;.</text>}>{item => <>
          <text fg={ctx.theme.text.accent}>{item().ref.url}</text>
          <Show when={item().error}><text fg={ctx.theme.text.base}>{item().error}</text></Show>
          <Show when={snapshot()}>{s => <scrollbox flexGrow={1}>
            <box flexDirection="column" gap={1}>
              <text>{s().title}</text>
              <text>{`${s().isDraft ? 'draft · ' : ''}${s().state} · ${s().headRefName} → ${s().baseRefName} · ${s().mergeStateStatus}`}</text>
              <text>{summaryLine(item())}</text>
              <Show when={mergeBlockers(s()).length}><text>Merge blocked: {mergeBlockers(s()).join(', ')}</text></Show>
              <text>Checks</text>
              <For each={s().checks}>{check => {
                const owner = sessionID()
                const target: FixTarget = { url: item().ref.url, kind: 'check', itemID: checkID(check), headSha: s().headSha }
                return (
                  <box flexDirection="column">
                    <text>{`${check.state}: ${check.name}${check.workflow ? ` (${check.workflow})` : ''}`}</text>
                    <Show when={check.state === 'fail'}><Button run={() => safely(() => fix(owner, target))}>Fix</Button></Show>
                  </box>
                )
              }}</For>
              <text>Latest reviews</text>
              <For each={s().reviews}>{review => <text>{`${review.author}: ${review.state}\n${review.body}`}</text>}</For>
              <text>Unresolved threads</text>
              <For each={s().threads}>{thread => {
                const owner = sessionID()
                const target: FixTarget = { url: item().ref.url, kind: 'thread', itemID: thread.id }
                return (
                  <box flexDirection="column">
                    <Button run={() => setExpanded(ids => ids.includes(thread.id) ? ids.filter(id => id !== thread.id) : [...ids, thread.id])}>{`${thread.path}:${thread.line ?? '?'} — ${thread.author}${thread.isOutdated ? ' (outdated)' : ''}`}</Button>
                    <text>{thread.body}</text>
                    <Show when={expanded().includes(thread.id)}><For each={thread.replies}>{reply => <text>{`${reply.author}: ${reply.body}`}</text>}</For></Show>
                    <Button run={() => safely(() => fix(owner, target))}>Fix thread</Button>
                  </box>
                )
              }}</For>
              <Show when={s().hasMoreThreads}><text>More threads exist on GitHub.</text></Show>
              <text>Recent comments</text>
              <For each={s().comments.filter(comment => !comment.isBot).slice(-5)}>{comment => <text>{`${comment.author}: ${comment.body}`}</text>}</For>
            </box>
          </scrollbox>}</Show>
        </>}</Show>
        <Show when={state()?.busy}><text>{state()?.busy}</text></Show>
        <Show when={state()?.notice}><text>{state()?.notice?.text}</text></Show>
        <Button run={pickMethod}>Merge method: {method() ?? 'none'}</Button>
        <For each={acts()}>{action => <Button run={() => doAction(action)}>{`${hotkey[action]}: ${actionLabel(action, method())}`}</Button>}</For>
      </box>
    }

    ctx.keymap.layer(() => ({
      mode: 'global',
      commands: [{
        id: 'lix42.pr', title: 'Pull request panel', palette: true,
        enabled: () => {
          const route = ctx.ui.router.current()
          return route.type === 'session' && !ctx.data.session.get(route.sessionID)?.parentID && enabled()[route.sessionID] !== false
        },
        slash: { name: 'pr', arguments: true },
        run: args => {
          safely(async () => {
            const sessionID = currentSession()
            const state = states()[sessionID]
            const url = state?.prs.find(pr => pr.ref.url === state.selected)?.ref.url ?? state?.prs.at(-1)?.ref.url
            const status = await rpc.status({}, location(sessionID)) as { enabled: boolean }
            if (!status.enabled) throw new Error('PR panel is disabled on this server')
            const result = await rpc.command({ sessionID, args: args ?? '', ...(url ? { url } : {}) }, location(sessionID)) as { text: string }
            ctx.ui.toast.show({ title: 'PR panel', message: result.text })
            if (!args?.trim() || !/^(?:agent|untrack)\b/.test(args.trim())) ctx.ui.panel.open(PANEL)
            await load(sessionID)
          })
        },
      }],
    }))
    stops.push(
      ctx.ui.slot({ append: 'session.composer.top', render: props => <Band sessionID={props.sessionID} /> }),
      ctx.ui.slot({ append: 'session.panel', render: panel => <Show when={panel.name === PANEL}><PanelView panel={panel} /></Show> }),
    )
    // RPC events are live-only. Periodic snapshot reads recover missed updates
    // after a disconnect without creating another GitHub poller per terminal.
    const recovery = setInterval(() => {
      for (const sessionID of watched.keys()) void load(sessionID).catch(() => {})
    }, 15_000)
    recovery.unref()
    return () => { disposed = true; clearInterval(recovery); for (const stop of stops) stop() }
  },
})
