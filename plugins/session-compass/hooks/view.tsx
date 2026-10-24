import type { EngineInterface } from 'claude-code'

import type { Entry, PromptEntry, ResponseEntry, Summaries } from '../types'
import { displayText, hashText } from './history'
import { SWATCHES } from './identity'

type Ui = ReturnType<EngineInterface['ui']['resolve']>

export type PaneHandlers = {
  select: (id: string) => void
  rewind: (entry: PromptEntry) => void
  copy: (entry: PromptEntry) => void
  cancel: () => void
  dismissNotice: () => void
  toggleEditor: () => void
  rename: (text: string) => void
  pickColor: (color: string) => void
}

export type PaneModel = {
  name: string | null
  place: string
  accent: string
  entries: readonly Entry[]
  summaries: Summaries
  confirming: string | null
  notice: string | null
  isEditing: boolean
}

/**
 * What the pane shows, as one string, so a change is seen: a new entry, a live
 * one growing, a summary, the editor or a notice. Which prompt shows its
 * rewind choice is left out: opening that on an old prompt keeps it in view.
 */
export const contentKey = (model: PaneModel) => {
  const last = model.entries.at(-1)
  const lastKey = last
    ? [last.id, last.text.length, last.kind === 'response' ? [last.isLive, Object.values(last.tools).reduce((a, b) => a + b, 0)] : ''].join(':')
    : ''
  // The summaries the entries show, counted: the store's own count stops at its cap.
  const summarized = model.entries.filter(entry => model.summaries[hashText(entry.text)]).length
  return [model.entries.length, lastKey, summarized, model.isEditing, model.notice, model.name].join('|')
}

/** Tools shown by name before the rest fold into "+n". */
const MAX_TOOLS = 4

const clock = (at: number) => {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const duration = (ms: number | null) => {
  if (ms === null) return ''
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

/** `Bash×3 Edit×2 +2`, most used first, Skill and Agent left to their own chips. */
export const toolChips = (tools: Record<string, number>) => {
  const counted = Object.entries(tools)
    .filter(([name]) => name !== 'Skill' && name !== 'Agent')
    .sort((a, b) => b[1] - a[1])
  const shown = counted.slice(0, MAX_TOOLS).map(([name, n]) => (n > 1 ? `${name}×${n}` : name))
  const more = counted.length - shown.length
  return [...shown, ...(more > 0 ? [`+${more}`] : [])].join(' ')
}

const renderPrompt = (ui: Ui, entry: PromptEntry, model: PaneModel, handlers: PaneHandlers) => {
  const { Box, Text, Button } = ui
  const shown = displayText(entry, model.summaries)
  const isConfirming = model.confirming === entry.id
  return (
    <Box key={entry.id} flexDirection="column">
      <Button key={`prompt-${entry.id}`} plain onPress={() => handlers.select(entry.id)}>
        <Text color={model.accent}>▌ </Text>
        {/* A rebuilt entry has no time of its own: none is drawn, rather than the rebuild's. */}
        {entry.at !== 0 && <Text dimColor>{clock(entry.at)} </Text>}
        {entry.command && (
          <Text color="suggestion" weight="semibold">
            /{entry.command.name}
            {entry.command.args ? ` ${entry.command.args}` : ''}
          </Text>
        )}
        {entry.command && shown.text ? ' ' : ''}
        <Text weight={entry.command ? undefined : "semibold"} italic={shown.isSummary}>
          {shown.text}
        </Text>
      </Button>
      {isConfirming && (
        <Box paddingLeft={2}>
          <Button key="rewind" label="Rewind…" variant="primary" hotkey="w" onPress={() => handlers.rewind(entry)} />
          <Button key="copy" label="Copy to prompt" hotkey="c" onPress={() => handlers.copy(entry)} />
          <Button key="cancel" label="Cancel" hotkey="n" onPress={handlers.cancel} />
        </Box>
      )}
    </Box>
  )
}

const renderResponse = (ui: Ui, entry: ResponseEntry, model: PaneModel) => {
  const { Box, Text } = ui
  const shown = displayText(entry, model.summaries)
  const tools = toolChips(entry.tools)
  const facts = [entry.isLive ? 'working…' : duration(entry.durationMs)].filter(Boolean).join(' ')
  const hasChips = entry.skills.length > 0 || entry.agents.length > 0 || tools !== ''
  return (
    <Box key={entry.id} flexDirection="column" paddingLeft={2}>
      {(hasChips || facts) && (
        <Text wrap="truncate">
          {entry.skills.map(skill => (
            <Text key={`skill-${skill}`} color="remember">
              ◆ {skill}{' '}
            </Text>
          ))}
          {entry.agents.map(agent => (
            <Text key={`agent-${agent}`} color="merged">
              ◇ {agent}{' '}
            </Text>
          ))}
          {tools && <Text color="subtle">{tools} </Text>}
          {facts && <Text dimColor>{facts}</Text>}
        </Text>
      )}
      {shown.text && (
        <Text dimColor={!shown.isSummary} italic={shown.isSummary}>
          {shown.text}
        </Text>
      )}
    </Box>
  )
}

export const renderPane = (ui: Ui, model: PaneModel, handlers: PaneHandlers) => {
  const { Box, Text, Button } = ui
  // Oldest first, as the transcript reads; the pane follows its end, so the name sits under the newest entry.
  return (
    <Box flexDirection="column" gap={1}>
      <Text dimColor>Press a prompt to rewind to it or copy it · ctrl+x tab focuses this pane</Text>
      {model.entries.length === 0 ? (
        <Text dimColor>Nothing yet: prompts and responses show here as the session goes.</Text>
      ) : (
        <Box flexDirection="column" gap={1}>
          {model.entries.map(entry =>
            entry.kind === 'prompt' ? renderPrompt(ui, entry, model, handlers) : renderResponse(ui, entry, model),
          )}
        </Box>
      )}
      {model.notice && (
        <Box>
          <Text color="warning">{model.notice} </Text>
          <Button key="dismiss-notice" label="Dismiss" plain dimColor onPress={handlers.dismissNotice} />
        </Box>
      )}
      <Box flexDirection="column">
        <Button key="edit-identity" plain onPress={handlers.toggleEditor}>
          <Text weight="semibold" color={model.accent} wrap="truncate">
            {model.name ?? 'Unnamed session'}
          </Text>
        </Button>
        <Text dimColor wrap="truncate">
          {model.place}
          {model.isEditing ? '' : ' · press the name to edit'}
        </Text>
      </Box>
      {model.isEditing && renderEditor(ui, model, handlers)}
    </Box>
  )
}

/** The swatches' hotkeys, in order: the digits, then letters for the rest. */
const SWATCH_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'a', 'b']

/** The name field and the color swatches, under the session's name. */
const renderEditor = (ui: Ui, model: PaneModel, handlers: PaneHandlers) => {
  const { Box, Text, Button } = ui
  // Mobile draws no text field: there the editor is the swatches alone.
  const Input = 'Input' in ui ? ui.Input : null
  return (
    <Box flexDirection="column" gap={1}>
      {Input && (
        <Input
          key="name-input"
          label="Name "
          value={model.name ?? ''}
          placeholder="Session name"
          submitLabel="rename"
          onSubmit={handlers.rename}
        />
      )}
      <Box flexDirection="column">
        <Text dimColor>Accent color · Tab, or keys 1–9 0 a</Text>
        <Box flexWrap="wrap" columnGap={1}>
          {SWATCHES.map(([colorName, hex], i) => (
            // One cell a swatch, the gap outside it, so the focus mark sits on the dot alone.
            <Button key={`color-${colorName}`} plain hotkey={SWATCH_KEYS[i]} onPress={() => handlers.pickColor(hex)}>
              <Text color={hex}>{hex === model.accent ? '◉' : '●'}</Text>
            </Button>
          ))}
        </Box>
      </Box>
      {Input && <Input key="hex-input" label="Hex " placeholder="#ff6b6b" submitLabel="set" onSubmit={handlers.pickColor} />}
      <Button key="done" label="Done" onPress={handlers.toggleEditor} />
    </Box>
  )
}
