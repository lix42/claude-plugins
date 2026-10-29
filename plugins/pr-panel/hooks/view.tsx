import type { EngineInterface } from 'claude-code'

import type { Check, MergeMethod, Notice, PrSnapshot, Thread, TrackedPr } from '../types'
import { actionLabel } from './actions'
import { availableActions, countChecks, mergeBlockers, methodLabel, summaryLine, type ActionId } from './derive'

type Ui = ReturnType<EngineInterface['ui']['resolve']>

export type PaneHandlers = {
  select: (url: string) => void
  refresh: () => void
  untrack: () => void
  pickMethod: (method: MergeMethod) => void
  act: (action: ActionId) => void
  cancel: () => void
  dismissNotice: () => void
  fixCheck: (check: Check) => void
  fixThread: (thread: Thread) => void
  toggleThread: (id: string) => void
}

/** What the pane draws besides the PR itself. */
export type PaneState = {
  method: MergeMethod | null
  busy: string | null
  expanded: readonly string[]
  /** The action of the shown PR awaiting its second press. */
  confirming: ActionId | null
  notice: Notice | null
}

/** Single keys that press a button while the pane holds the keyboard (ctrl+x tab). */
const ACTION_HOTKEY: Record<ActionId, string> = {
  'auto-enable': 'a',
  'auto-disable': 'a',
  merge: 'm',
  bypass: 'b',
  ready: 'd',
  rerun: 'x',
}

const MAX_BAND_ROWS = 3
const MAX_COMMENTS = 3

const firstLines = (text: string, lines: number) => {
  const clean = text.replace(/<!--[\s\S]*?-->/g, '').trim().split('\n').filter(Boolean)
  return clean.slice(0, lines).join(' ') + (clean.length > lines ? ' …' : '')
}

/** A merged PR's band line is green; a closed one is dimmed. */
const bandStyle = (pr: TrackedPr) => ({
  color: pr.snapshot?.state === 'MERGED' ? ('success' as const) : undefined,
  dimColor: pr.snapshot?.state === 'CLOSED',
})

const CHECK_MARK = { fail: '✗', pending: '…', pass: '✓', skipped: '–' } as const
const CHECK_COLOR = { fail: 'error', pending: 'warning', pass: 'success', skipped: 'inactive' } as const

export const renderBand = (ui: Ui, list: readonly TrackedPr[], maxRows: number) => {
  const { Box, Text } = ui
  if (maxRows <= 1 && list.length > 1) {
    // One row: the newest PR and how many more, together.
    const newest = list[list.length - 1]
    return (
      <Text {...(newest ? bandStyle(newest) : {})} wrap="truncate">
        {newest ? summaryLine(newest) : ''} · +{list.length - 1} more · /pr
      </Text>
    )
  }
  // One row is kept for the "+n more" line whenever anything is left out.
  const room = Math.min(MAX_BAND_ROWS, list.length > maxRows ? maxRows - 1 : maxRows)
  const shown = list.slice(-Math.max(1, room))
  const hidden = list.length - shown.length
  return (
    <Box flexDirection="column">
      {shown.map(pr => (
        <Text key={pr.ref.url} {...bandStyle(pr)} wrap="truncate">
          {summaryLine(pr)}
        </Text>
      ))}
      {hidden > 0 && <Text dimColor>+{hidden} more · /pr to open the panel</Text>}
    </Box>
  )
}

const renderHeader = (ui: Ui, pr: TrackedPr, s: PrSnapshot) => {
  const { Box, Text, Link } = ui
  const facts = [
    s.isDraft ? 'draft' : s.state.toLowerCase(),
    `${s.headRefName} → ${s.baseRefName}`,
    s.state === 'OPEN' && s.mergeStateStatus ? `merge state: ${s.mergeStateStatus.toLowerCase()}` : '',
    s.reviewDecision ? `review: ${s.reviewDecision.toLowerCase().replace('_', ' ')}` : '',
    s.state === 'OPEN' ? `auto-merge: ${s.autoMerge ? methodLabel(s.autoMerge.method) : 'off'}` : '',
  ].filter(Boolean)
  return (
    <Box flexDirection="column">
      <Text bold color={s.state === 'MERGED' ? 'success' : undefined}>
        #{pr.ref.number} {s.title}
      </Text>
      <Link href={pr.ref.url} label={pr.ref.url} />
      <Text dimColor>{facts.join(' · ')}</Text>
    </Box>
  )
}

const renderChecks = (ui: Ui, s: PrSnapshot, handlers: PaneHandlers) => {
  const { Box, Text, Button } = ui
  const c = countChecks(s.checks)
  if (c.total === 0) return <Text dimColor>No checks</Text>
  const listed = s.checks.filter(check => check.state === 'fail' || check.state === 'pending')
  const firstFailed = listed.find(check => check.state === 'fail')
  return (
    <Box flexDirection="column">
      <Text bold>
        Checks <Text color="success">✓{c.pass}</Text>
        {c.fail > 0 && <Text color="error"> ✗{c.fail}</Text>}
        {c.pending > 0 && <Text color="warning"> …{c.pending}</Text>}
        {c.skipped > 0 && <Text dimColor> –{c.skipped}</Text>}
      </Text>
      {listed.map((check, i) => (
        <Box key={`check-${i}`}>
          <Text color={CHECK_COLOR[check.state]}>
            {'  '}
            {CHECK_MARK[check.state]} {check.workflow ? `${check.workflow} / ` : ''}
            {check.name}{' '}
          </Text>
          {check.state === 'fail' && (
            <Button
              key={`fix-check-${i}`}
              label="Fix"
              hotkey={check === firstFailed ? 'f' : undefined}
              onPress={() => handlers.fixCheck(check)}
            />
          )}
        </Box>
      ))}
    </Box>
  )
}

const renderReviews = (ui: Ui, s: PrSnapshot) => {
  const { Text } = ui
  if (s.reviews.length === 0) return null
  const items = s.reviews.map(r => `${r.author} ${r.state.toLowerCase().replace('_', ' ')}`)
  return (
    <Text>
      <Text bold>Reviews</Text> {items.join(' · ')}
    </Text>
  )
}

const threadMarkdown = (thread: Thread) =>
  [{ author: thread.author, body: thread.body }, ...thread.replies]
    .map(c => `**${c.author}**: ${c.body.replace(/<!--[\s\S]*?-->/g, '').trim()}`)
    .join('\n\n')

const renderThreads = (ui: Ui, s: PrSnapshot, expanded: readonly string[], handlers: PaneHandlers) => {
  const { Box, Text, Button, Markdown } = ui
  if (s.threads.length === 0) return null
  return (
    <Box flexDirection="column">
      <Text bold>
        Unresolved threads ({s.threads.length}){s.hasMoreThreads ? ' · only the first 100 threads are checked' : ''}
      </Text>
      {s.threads.map((thread, i) => {
        const isOpen = expanded.includes(thread.id)
        const replies = thread.replies.length ? ` (+${thread.replies.length})` : ''
        return (
          <Box key={`thread-${i}`} flexDirection="column">
            <Box>
              <Button key={`toggle-thread-${i}`} plain onPress={() => handlers.toggleThread(thread.id)}>
                {isOpen ? '▾ ' : '▸ '}
                <Text color="suggestion">
                  {thread.path}
                  {thread.line ? `:${thread.line}` : ''}
                </Text>{' '}
                {thread.author}
                {replies}: {isOpen ? '' : firstLines(thread.body, 1)}
              </Button>
              <Text> </Text>
              <Button key={`fix-thread-${i}`} label="Fix" onPress={() => handlers.fixThread(thread)} />
            </Box>
            {isOpen && (
              <Box flexDirection="column" paddingLeft={4}>
                <Markdown key={`thread-body-${i}`} text={threadMarkdown(thread)} />
                {thread.commentCount > thread.replies.length + 1 && (
                  <Text color="warning">+{thread.commentCount - thread.replies.length - 1} more comments on GitHub</Text>
                )}
                <Text dimColor>{thread.url}</Text>
              </Box>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

const renderComments = (ui: Ui, s: PrSnapshot) => {
  const { Box, Text } = ui
  if (s.comments.length === 0) return null
  const people = s.comments.filter(c => !c.isBot)
  const bots = s.comments.length - people.length
  return (
    <Box flexDirection="column">
      <Text bold>
        Comments ({people.length}
        {bots > 0 ? `, ${bots} from bots` : ''})
      </Text>
      {people.slice(-MAX_COMMENTS).map((comment, i) => (
        <Text key={`comment-${i}`} wrap="truncate">
          {'  '}
          <Text bold>{comment.author}</Text>: {firstLines(comment.body, 2)}
        </Text>
      ))}
    </Box>
  )
}

const renderActions = (ui: Ui, s: PrSnapshot, state: PaneState, handlers: PaneHandlers) => {
  const { Box, Text, Button } = ui
  const { method, confirming } = state
  const actions = availableActions(s, method)
  const blockers = mergeBlockers(s)
  if (actions.length === 0 && blockers.length === 0) return null
  const showMethod =
    s.repo.methods.length > 1 && actions.some(a => a === 'auto-enable' || a === 'merge' || a === 'bypass')
  return (
    <Box flexDirection="column">
      {blockers.length > 0 && <Text color="warning">Merge blocked: {blockers.join(', ')}</Text>}
      {showMethod && (
        // The label on its own line: beside the buttons, a narrow pane squeezes it to a column of letters.
        <Box flexDirection="column">
          <Text dimColor>Merge method</Text>
          <Box flexWrap="wrap">
            {s.repo.methods.map(m => (
              <Button
                key={`method-${m}`}
                label={methodLabel(m)}
                variant={m === method ? 'primary' : undefined}
                onPress={() => handlers.pickMethod(m)}
              />
            ))}
          </Box>
        </Box>
      )}
      {confirming ? (
        <Box>
          <Text color={confirming === 'bypass' ? 'error' : 'warning'}>{actionLabel(confirming, method)} now? </Text>
          <Button key="confirm" label="Confirm" variant="primary" hotkey="y" onPress={() => handlers.act(confirming)} />
          <Button key="cancel" label="Cancel" hotkey="n" onPress={handlers.cancel} />
        </Box>
      ) : (
        <Box>
          {actions.map(action => (
            <Button
              key={`action-${action}`}
              label={actionLabel(action, method)}
              variant={action === 'auto-enable' || action === 'merge' ? 'primary' : undefined}
              hotkey={ACTION_HOTKEY[action]}
              onPress={() => handlers.act(action)}
            />
          ))}
        </Box>
      )}
    </Box>
  )
}

export const renderPane = (
  ui: Ui,
  list: readonly TrackedPr[],
  pr: TrackedPr | null,
  state: PaneState,
  handlers: PaneHandlers,
) => {
  const { Box, Text, Button } = ui
  if (!pr) return <Text dimColor>No PRs tracked. Run /pr &lt;url|number&gt; to add one.</Text>
  const s = pr.snapshot

  return (
    <Box flexDirection="column" gap={1}>
      <Box>
        {list.length > 1 &&
          list.map((item, i) => (
            <Button
              key={`tab-${item.ref.url}`}
              label={`#${item.ref.number}`}
              hotkey={i < 9 ? String(i + 1) : undefined}
              variant={item.ref.url === pr.ref.url ? 'primary' : undefined}
              onPress={() => handlers.select(item.ref.url)}
            />
          ))}
        <Button key="refresh" label="Refresh" hotkey="r" onPress={handlers.refresh} />
        <Button key="untrack" label="Untrack" hotkey="u" onPress={handlers.untrack} />
      </Box>
      {state.busy && <Text color="warning">{state.busy}…</Text>}
      {state.notice && (
        <Box>
          <Text color={state.notice.isError ? 'error' : 'success'}>{state.notice.text} </Text>
          <Button key="dismiss-notice" label="Dismiss" plain dimColor onPress={handlers.dismissNotice} />
        </Box>
      )}
      {pr.error && <Text color="error">{pr.error.split('\n')[0]}</Text>}
      {s === null ? (
        <Text dimColor>Loading #{pr.ref.number}…</Text>
      ) : (
        <Box flexDirection="column" gap={1}>
          {renderHeader(ui, pr, s)}
          {renderChecks(ui, s, handlers)}
          {renderReviews(ui, s)}
          {renderThreads(ui, s, state.expanded, handlers)}
          {renderComments(ui, s)}
          {renderActions(ui, s, state, handlers)}
        </Box>
      )}
      <Text dimColor>ctrl+x tab focuses this pane · Tab/arrows move · Enter presses · Esc returns</Text>
    </Box>
  )
}
