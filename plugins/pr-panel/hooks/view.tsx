import type { EngineInterface } from 'claude-code'

import type { Check, MergeMethod, PrSnapshot, Thread, TrackedPr } from '../types'
import { actionLabel } from './actions'
import { availableActions, countChecks, methodLabel, summaryLine, type ActionId } from './derive'

type Ui = ReturnType<EngineInterface['ui']['resolve']>

export type PaneHandlers = {
  select: (url: string) => void
  refresh: () => void
  untrack: () => void
  pickMethod: (method: MergeMethod) => void
  act: (action: ActionId) => void
  fixCheck: (check: Check) => void
  fixThread: (thread: Thread) => void
}

const MAX_BAND_ROWS = 3
const MAX_COMMENTS = 3

const firstLines = (text: string, lines: number) => {
  const clean = text.replace(/<!--[\s\S]*?-->/g, '').trim().split('\n').filter(Boolean)
  return clean.slice(0, lines).join(' ') + (clean.length > lines ? ' …' : '')
}

const CHECK_MARK = { fail: '✗', pending: '…', pass: '✓', skipped: '–' } as const
const CHECK_COLOR = { fail: 'error', pending: 'warning', pass: 'success', skipped: 'inactive' } as const

export const renderBand = (ui: Ui, list: readonly TrackedPr[], maxRows: number) => {
  const { Box, Text } = ui
  // One row is kept for the "+n more" line whenever anything is left out.
  const room = Math.max(1, Math.min(MAX_BAND_ROWS, list.length > maxRows ? maxRows - 1 : maxRows))
  const shown = list.slice(-room)
  const hidden = list.length - shown.length
  return (
    <Box flexDirection="column">
      {shown.map(pr => (
        <Text key={pr.ref.url} dimColor={pr.snapshot !== null && pr.snapshot.state !== 'OPEN'} wrap="truncate">
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
      <Text bold>
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
          {check.state === 'fail' && <Button key={`fix-check-${i}`} label="Fix" onPress={() => handlers.fixCheck(check)} />}
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

const renderThreads = (ui: Ui, s: PrSnapshot, handlers: PaneHandlers) => {
  const { Box, Text, Button } = ui
  if (s.threads.length === 0) return null
  return (
    <Box flexDirection="column">
      <Text bold>Unresolved threads ({s.threads.length})</Text>
      {s.threads.map((thread, i) => (
        <Box key={`thread-${i}`}>
          <Text wrap="truncate">
            {'  '}
            <Text color="suggestion">
              {thread.path}
              {thread.line ? `:${thread.line}` : ''}
            </Text>{' '}
            {thread.author}: {firstLines(thread.body, 1)}{' '}
          </Text>
          <Button key={`fix-thread-${i}`} label="Fix" onPress={() => handlers.fixThread(thread)} />
        </Box>
      ))}
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

const renderActions = (ui: Ui, pr: TrackedPr, s: PrSnapshot, method: MergeMethod | null, handlers: PaneHandlers) => {
  const { Box, Text, Button } = ui
  const actions = availableActions(s, method)
  if (actions.length === 0) return null
  const showMethod = s.repo.methods.length > 1 && (actions.includes('auto-enable') || actions.includes('merge'))
  return (
    <Box flexDirection="column">
      {showMethod && (
        <Box>
          <Text dimColor>Merge method </Text>
          {s.repo.methods.map(m => (
            <Button
              key={`method-${m}`}
              label={methodLabel(m)}
              variant={m === method ? 'primary' : undefined}
              onPress={() => handlers.pickMethod(m)}
            />
          ))}
        </Box>
      )}
      <Box>
        {actions.map(action => (
          <Button
            key={`action-${action}`}
            label={actionLabel(action, method)}
            variant={action === 'auto-enable' ? 'primary' : undefined}
            onPress={() => handlers.act(action)}
          />
        ))}
      </Box>
      {s.mergeable === 'CONFLICTING' && <Text color="error">Has merge conflicts with {s.baseRefName}</Text>}
    </Box>
  )
}

export const renderPane = (
  ui: Ui,
  list: readonly TrackedPr[],
  pr: TrackedPr | null,
  method: MergeMethod | null,
  busyLabel: string | null,
  handlers: PaneHandlers,
) => {
  const { Box, Text, Button } = ui
  if (!pr) return <Text dimColor>No PRs tracked. Run /pr &lt;url|number&gt; to add one.</Text>
  const s = pr.snapshot

  return (
    <Box flexDirection="column" gap={1}>
      <Box>
        {list.map(item => (
          <Button
            key={`tab-${item.ref.url}`}
            label={`#${item.ref.number}`}
            variant={item.ref.url === pr.ref.url ? 'primary' : undefined}
            onPress={() => handlers.select(item.ref.url)}
          />
        ))}
        <Button key="refresh" label="Refresh" onPress={handlers.refresh} />
        <Button key="untrack" label="Untrack" onPress={handlers.untrack} />
      </Box>
      {busyLabel && <Text color="warning">{busyLabel}…</Text>}
      {pr.error && <Text color="error">{pr.error.split('\n')[0]}</Text>}
      {s === null ? (
        <Text dimColor>Loading #{pr.ref.number}…</Text>
      ) : (
        <Box flexDirection="column" gap={1}>
          {renderHeader(ui, pr, s)}
          {renderChecks(ui, s, handlers)}
          {renderReviews(ui, s)}
          {renderThreads(ui, s, handlers)}
          {renderComments(ui, s)}
          {renderActions(ui, pr, s, method, handlers)}
        </Box>
      )}
    </Box>
  )
}
