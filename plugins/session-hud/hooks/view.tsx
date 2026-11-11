import type { EngineInterface } from 'claude-code'

import type { Activity, CommandRow, Group, LiveSession, Place, Section, Status, Usage } from '../types'
import { GROUPS, LIMIT_LABELS, byPlugin, liveState, rowsOf, bar, elapsed, isOnExtraUsage, levelColor, resetsIn, tokens } from './model'

type Ui = ReturnType<EngineInterface['ui']['resolve']>

export type HudModel = {
  place: Place | null
  usage: Usage | null
  commands: readonly CommandRow[]
  status: Status
  now: number
  open: Partial<Record<Section, boolean>>
  pins: readonly string[]
  notice: string | null
  expanded: string | null
  live: Readonly<Record<string, LiveSession>> | null
  forks: readonly string[]
  activity: Readonly<Record<string, Activity>>
}

export type HudHandlers = {
  insert: (name: string) => void
  toggle: (section: Section) => void
  pin: (name: string) => void
  refresh: () => void
  /** Reads the forks and their states, the usage and the place again. */
  refreshStatus: () => void
  dismissNotice: () => void
  expand: (id: string) => void
}

const Heading = (ui: Ui, title: string) => (
  <ui.Text weight="semibold" color="claude">
    {title}
  </ui.Text>
)

const Field = (ui: Ui, key: string, label: string, value: string, color?: string) => (
  <ui.Text key={key} wrap="truncate">
    <ui.Text dimColor>{label.padEnd(8)}</ui.Text>
    <ui.Text color={color}>{value}</ui.Text>
  </ui.Text>
)

const renderContext = (ui: Ui, model: HudModel) => {
  const { Box, Text } = ui
  const place = model.place
  if (!place) return <Text dimColor>Reading the session…</Text>
  return (
    <Box flexDirection="column">
      {Field(ui, 'path', 'path', place.path)}
      {Field(ui, 'repo', 'repo', place.repo ?? '(not a git repo)')}
      {place.branch && Field(ui, 'branch', 'branch', place.branch, 'suggestion')}
      {Field(ui, 'session', 'session', `${place.sessionId.slice(0, 8)}${model.usage ? ` · up ${elapsed(model.now - model.usage.startedAt)}` : ''}`)}
      {Field(ui, 'model', 'model', place.model)}
    </Box>
  )
}

const renderUsage = (ui: Ui, model: HudModel) => {
  const { Box, Text } = ui
  const usage = model.usage
  if (!usage) return <Text dimColor>No usage figures yet.</Text>
  const percent = usage.contextPercent
  return (
    <Box flexDirection="column">
      <Text key="context" wrap="truncate">
        <Text dimColor>{'context'.padEnd(8)}</Text>
        {percent === null ? (
          <Text dimColor>— of {tokens(usage.contextWindow)}</Text>
        ) : (
          <Text>
            <Text color={levelColor(percent)}>{bar(percent)}</Text> {Math.round(percent)}%
            <Text dimColor>
              {' '}
              {usage.contextTokens === null ? '' : tokens(usage.contextTokens)}/{tokens(usage.contextWindow)}
            </Text>
          </Text>
        )}
      </Text>
      {usage.rateLimits.map(limit => (
        <Text key={`limit-${limit.kind}`} wrap="truncate">
          <Text dimColor>{(LIMIT_LABELS[limit.kind] ?? limit.kind).padEnd(8)}</Text>
          <Text color={levelColor(limit.percentUsed)}>{bar(limit.percentUsed)}</Text> {Math.round(limit.percentUsed)}%
          <Text dimColor> {resetsIn(limit.resetsAt, model.now)}</Text>
        </Text>
      ))}
      {/* The cost only matters once it is billed beyond the plan. */}
      {usage.costUsd !== null && isOnExtraUsage(usage.rateLimits) && (
        <Text key="cost" wrap="truncate">
          <Text dimColor>{'cost'.padEnd(8)}</Text>
          <Text color="warning">${usage.costUsd.toFixed(2)}</Text>
          <Text dimColor> this session · extra usage</Text>
        </Text>
      )}
    </Box>
  )
}

const renderStatus = (ui: Ui, model: HudModel) => {
  const { Box, Text } = ui
  const s = model.status
  const forTime = s.since ? elapsed(model.now - s.since) : ''
  const head =
    s.phase === 'working' ? (
      <Text key="phase" color="warning" weight="semibold">
        ● Working {elapsed(model.now - (s.turnStartedAt || s.since))}
      </Text>
    ) : s.phase === 'waiting' ? (
      <Text key="phase" color="permission" weight="semibold">
        ◐ Waiting for you {forTime}
      </Text>
    ) : (
      <Text key="phase" color="success" weight="semibold">
        ○ Idle {s.since ? forTime : ''}
      </Text>
    )
  const last =
    s.phase === 'idle' && s.lastDurationMs !== null
      ? `last turn ${elapsed(s.lastDurationMs)}${s.lastReason && s.lastReason !== 'answer' ? ` · ${s.lastReason}` : ''}`
      : ''
  const counts = [s.toolCount ? `${s.toolCount} tool${s.toolCount === 1 ? '' : 's'}` : '', s.agents ? `${s.agents} subagent${s.agents === 1 ? '' : 's'} running` : '']
    .filter(Boolean)
    .join(' · ')
  return (
    <Box flexDirection="column">
      {head}
      {s.phase !== 'idle' && s.tool && (
        <Text key="tool" wrap="truncate">
          <Text dimColor>↳ </Text>
          <Text color="suggestion">{s.tool}</Text>
          {s.toolDetail ? <Text dimColor> {s.toolDetail}</Text> : ''}
        </Text>
      )}
      {s.prompt && (
        <Text key="prompt" wrap="truncate" italic>
          “{s.prompt}”
        </Text>
      )}
      {(last || counts) && (
        <Text key="facts" dimColor wrap="truncate">
          {[last, counts].filter(Boolean).join(' · ')}
        </Text>
      )}
    </Box>
  )
}

/**
 * One command: its name puts it in the prompt; `?>` beside it opens its
 * description on the lines below, at the pane's full width, and closes it
 * again; the star pins it to the top group, or unpins it.
 */
const renderRow = (ui: Ui, row: CommandRow, group: Group, model: HudModel, handlers: HudHandlers) => {
  const { Box, Text, Button } = ui
  // By group, as a pinned command is listed twice: under Pinned and under its scope.
  const id = `${group}:${row.name}`
  const isExpanded = model.expanded === id
  const isPinned = model.pins.includes(row.name)
  const head = (
    <Box key={isExpanded ? 'open-head' : 'head'} flexDirection="row">
      <Button key={`cmd-${group}-${row.name}`} plain onPress={() => handlers.insert(row.name)}>
        <Text color="suggestion">/{row.name}</Text>
      </Button>
      {row.description && (
        <Box key="toggle" paddingLeft={1}>
          <Button key={`desc-${group}-${row.name}`} plain dimColor onPress={() => handlers.expand(id)}>
            <Text dimColor>{isExpanded ? '?v' : '?>'}</Text>
          </Button>
        </Box>
      )}
      <Box key="pin" paddingLeft={1}>
        <Button key={`pin-${group}-${row.name}`} plain onPress={() => handlers.pin(row.name)}>
          <Text color={isPinned ? 'warning' : undefined} dimColor={!isPinned}>
            {isPinned ? '★' : '☆'}
          </Text>
        </Button>
      </Box>
    </Box>
  )
  // Keys of its own when open, so the terminal builds the Boxes anew rather than keeping the closed row's layout.
  return (
    <Box key={isExpanded ? `open-${id}` : `row-${id}`} flexDirection="column" paddingLeft={2}>
      {head}
      {isExpanded && (
        <Box key="open-description" width="100%">
          <Button key={`text-${group}-${row.name}`} plain onPress={() => handlers.expand(id)}>
            <Text wrap="wrap">{row.description}</Text>
          </Button>
        </Box>
      )}
    </Box>
  )
}

/** Under Plugins, one sub-group a plugin, closed until opened: there are many. */
const renderPlugins = (ui: Ui, rows: readonly CommandRow[], model: HudModel, handlers: HudHandlers) => {
  const { Box, Text, Button } = ui
  return byPlugin(rows).map(([plugin, own]) => {
    const section = `plugin:${plugin}` as const
    const isOpen = model.open[section] ?? false
    return (
      <Box key={`plugin-${plugin}`} flexDirection="column" paddingLeft={2}>
        <Button key={`toggle-plugin-${plugin}`} plain onPress={() => handlers.toggle(section)}>
          <Text dimColor>{isOpen ? '▾' : '▸'} </Text>
          <Text>{plugin}</Text>
          <Text dimColor> ({own.length})</Text>
        </Button>
        {isOpen && own.map(row => renderRow(ui, row, 'plugin', model, handlers))}
      </Box>
    )
  })
}

/**
 * This conversation's forks running as background sessions of their own,
 * oldest first: each with its state, what it does now and its latest prompt,
 * read from its transcript. Shown once there is one.
 */
const renderSessions = (ui: Ui, model: HudModel) => {
  const { Box, Text } = ui
  if (model.forks.length === 0) return null
  const fork = (id: string) => {
    const session = model.live?.[id]
    const state = liveState(session)
    const doing = model.activity[id]
    const isWorking = state.word === 'working'
    const time = isWorking
      ? doing?.turnStartedAt
        ? elapsed(model.now - doing.turnStartedAt)
        : ''
      : doing?.lastAt
        ? `${elapsed(model.now - doing.lastAt)} ago`
        : ''
    return (
      <Box key={`conv-${id}`} flexDirection="column">
        <Text wrap="truncate">
          <Text color={state.color} dimColor={!state.color}>
            {state.mark}{' '}
          </Text>
          <Text>{session?.name || `session ${id.slice(0, 8)}`}</Text>
        </Text>
        <Text key="state" wrap="truncate">
          {'  '}
          <Text color={state.color} dimColor={!state.color}>
            {state.word}
          </Text>
          {time ? <Text dimColor> {time}</Text> : ''}
          <Text dimColor> · ⑂ fork {session?.shortId ?? id.slice(0, 8)}</Text>
        </Text>
        {isWorking && doing?.tool && (
          <Text key="tool" wrap="truncate">
            {'  '}
            <Text dimColor>↳ </Text>
            <Text color="suggestion">{doing.tool}</Text>
            {doing.toolDetail ? <Text dimColor> {doing.toolDetail}</Text> : ''}
          </Text>
        )}
        {doing?.prompt && (
          <Text key="prompt" wrap="truncate" italic dimColor>
            {'  '}“{doing.prompt}”
          </Text>
        )}
      </Box>
    )
  }
  return (
    <Box key="sessions" flexDirection="column" paddingTop={1} gap={1}>
      <Text dimColor>Other sessions of this conversation</Text>
      {model.forks.map(fork)}
    </Box>
  )
}

const renderCommands = (ui: Ui, model: HudModel, handlers: HudHandlers) => {
  const { Box, Text, Button } = ui
  return (
    <Box flexDirection="column">
      {GROUPS.map(group => {
        const rows = rowsOf(group.scope, model.commands, model.pins)
        // Pinned shows once something is pinned; Project and User always, to say they hold none.
        if (rows.length === 0 && group.scope !== 'project' && group.scope !== 'user') return null
        const isOpen = model.open[group.scope] ?? group.isOpenByDefault
        return (
          <Box key={`group-${group.scope}`} flexDirection="column">
            <Button key={`toggle-${group.scope}`} plain onPress={() => handlers.toggle(group.scope)}>
              <Text dimColor>{isOpen ? '▾' : '▸'} </Text>
              <Text weight="semibold" color={group.scope === 'pinned' ? 'warning' : undefined}>
                {group.title}
              </Text>
              <Text dimColor> ({rows.length})</Text>
            </Button>
            {isOpen && rows.length === 0 && (
              <Text dimColor>
                {'  '}none
              </Text>
            )}
            {isOpen &&
              (group.scope === 'plugin'
                ? renderPlugins(ui, rows, model, handlers)
                : rows.map(row => renderRow(ui, row, group.scope, model, handlers)))}
          </Box>
        )
      })}
    </Box>
  )
}

export const renderHud = (ui: Ui, model: HudModel, handlers: HudHandlers) => {
  const { Box, Text, Button } = ui
  return (
    <Box flexDirection="column" gap={1}>
      {model.notice && (
        <Box key="notice">
          <Text color="warning">{model.notice} </Text>
          <Button key="dismiss-notice" label="Dismiss" plain dimColor onPress={handlers.dismissNotice} />
        </Box>
      )}
      <Box key="context" flexDirection="column">
        {Heading(ui, 'Context')}
        {renderContext(ui, model)}
      </Box>
      <Box key="usage" flexDirection="column">
        {Heading(ui, 'Usage')}
        {renderUsage(ui, model)}
      </Box>
      {/* Above the commands: their list runs long, and the status is what changes. */}
      <Box key="status" flexDirection="column">
        <Box>
          {Heading(ui, 'Status')}
          <Button key="refresh-status" label="↻" plain dimColor onPress={handlers.refreshStatus} />
        </Box>
        {renderStatus(ui, model)}
        {renderSessions(ui, model)}
      </Box>
      <Box key="commands" flexDirection="column">
        <Box>
          {Heading(ui, 'Skills & commands')}
          <Button key="refresh" label="↻" plain dimColor onPress={handlers.refresh} />
        </Box>
        <Text dimColor>{'Press a name to put it in the prompt, ?> to read what it does, ☆ to pin it'}</Text>
        {renderCommands(ui, model, handlers)}
      </Box>
    </Box>
  )
}
