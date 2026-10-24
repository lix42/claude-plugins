import type { CommandRef, Entry, PromptEntry, ResponseEntry, Summaries } from '../types'

/** Entries kept; older ones leave the pane. */
export const MAX_ENTRIES = 300
/** A text longer than this, or of more lines than SUMMARY_LINES, is summarized. */
export const SUMMARY_CHARS = 140
export const SUMMARY_LINES = 2

/** The parts of a `$.session.messages()` row this module reads. */
export type MessageRow = {
  role: 'user' | 'assistant'
  text: string
  toolUses: readonly { tool: string; input?: unknown }[]
  toolResults?: readonly unknown[]
}

const keep = (list: Entry[]) => list.slice(-MAX_ENTRIES)

export const addPrompt = (list: Entry[], prompt: PromptEntry): Entry[] => keep([...list, prompt])

export const startResponse = (list: Entry[], id: string, at: number): Entry[] =>
  keep([...list, { kind: 'response', id, at, text: '', tools: {}, skills: [], agents: [], durationMs: null, isLive: true }])

const updateLive = (list: Entry[], fn: (r: ResponseEntry) => ResponseEntry): Entry[] => {
  const i = list.findLastIndex(entry => entry.kind === 'response' && entry.isLive)
  const live = list[i]
  if (live?.kind !== 'response') return list
  return list.with(i, fn(live))
}

const addOnce = (names: string[], name: string | undefined) =>
  name && !names.includes(name) ? [...names, name] : names

/** Counts one tool call of the main loop into the response that runs. */
export const recordTool = (list: Entry[], tool: string, input: { skill?: unknown; subagent_type?: unknown }): Entry[] =>
  updateLive(list, r => ({
    ...r,
    tools: { ...r.tools, [tool]: (r.tools[tool] ?? 0) + 1 },
    skills: tool === 'Skill' && typeof input.skill === 'string' ? addOnce(r.skills, input.skill) : r.skills,
    agents:
      tool === 'Agent' ? addOnce(r.agents, typeof input.subagent_type === 'string' ? input.subagent_type : 'agent') : r.agents,
  }))

export const finishResponse = (list: Entry[], text: string, durationMs: number): Entry[] =>
  updateLive(list, r => ({ ...r, text: text.trim(), durationMs, isLive: false }))

/** Ends any response left running (an interrupted turn, a reload mid-turn). */
export const settleLive = (list: Entry[]): Entry[] =>
  list.some(entry => entry.kind === 'response' && entry.isLive)
    ? list.map(entry => (entry.kind === 'response' && entry.isLive ? { ...entry, isLive: false } : entry))
    : list

// Rows the engine writes as user messages that the person did not type.
const META_PREFIXES = [
  '<local-command-caveat>',
  '<local-command-stdout>',
  '<local-command-stderr>',
  '<task-notification>',
  '<system-reminder>',
  'Base directory for this skill:',
  'Claude Code sent this note',
  'Caveat: The messages below',
  '[Request interrupted',
  'This session is being continued from a previous conversation',
]

export const isMetaText = (text: string) => {
  const head = text.trimStart()
  return head === '' || META_PREFIXES.some(prefix => head.startsWith(prefix))
}

// A command row opens with its name, or with its message and then its name.
const COMMAND_NAME = /^(?:<command-message>[\s\S]*?<\/command-message>\s*)?<command-name>\/?([^<]+)<\/command-name>/
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/

/** A transcript row of a slash command, `<command-name>/x</command-name>…`, as the command. */
export const parseCommandText = (text: string): CommandRef | null => {
  const head = text.trimStart()
  const name = COMMAND_NAME.exec(head)?.[1]?.trim()
  if (!name) return null
  return { name, args: (COMMAND_ARGS.exec(head)?.[1] ?? '').trim() }
}

/**
 * Rebuilds the history from the transcript, for a session that resumed, or one
 * a rewind cut short: each prompt the person sent, and the response after it.
 *
 * The rows carry no time, so the entries' `at` is 0, which draws no time.
 */
export const fromMessages = (rows: readonly MessageRow[]): Entry[] => {
  const at = 0
  const list: Entry[] = []
  let response: ResponseEntry | null = null
  // A row right after a command row is the command's own expansion (a commands/*.md body), not a prompt.
  let isAfterCommand = false
  const flush = () => {
    if (response) list.push({ ...response, text: response.text.trim() })
    response = null
  }

  rows.forEach((row, i) => {
    if (row.role === 'user') {
      if (row.toolResults?.length && row.text === '') return
      const command = parseCommandText(row.text)
      const wasAfterCommand = isAfterCommand
      isAfterCommand = command !== null
      if (!command && (isMetaText(row.text) || wasAfterCommand)) return
      flush()
      list.push({ kind: 'prompt', id: `m-${i}`, at, text: command ? '' : row.text.trim(), command })
      return
    }
    isAfterCommand = false
    response ??= { kind: 'response', id: `m-${i}`, at, text: '', tools: {}, skills: [], agents: [], durationMs: null, isLive: false }
    // The last text the agent wrote in the turn stands for it, as a live turn's answer does.
    if (row.text.trim()) response.text = row.text
    for (const use of row.toolUses) {
      const input = (use.input ?? {}) as { skill?: unknown; subagent_type?: unknown }
      response.tools = { ...response.tools, [use.tool]: (response.tools[use.tool] ?? 0) + 1 }
      if (use.tool === 'Skill' && typeof input.skill === 'string') response.skills = addOnce(response.skills, input.skill)
      if (use.tool === 'Agent')
        response.agents = addOnce(response.agents, typeof input.subagent_type === 'string' ? input.subagent_type : 'agent')
    }
  })
  flush()
  return keep(list)
}

/** Raised when the summary prompt changes, so summaries written by the old one are asked for again. */
const SUMMARY_VERSION = 2

/** A short, stable key for a text, so a summary is asked for once per text. */
export const hashText = (text: string) => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `v${SUMMARY_VERSION}-${(h >>> 0).toString(36)}-${text.length}`
}

/** A text's lines that show: blank and whitespace-only ones are left out. */
const shownLines = (text: string) => text.split('\n').filter(line => line.trim())

export const isLong = (text: string) => text.length > SUMMARY_CHARS || shownLines(text).length > SUMMARY_LINES

/** The texts to summarize next, newest first: long, finished, and not asked for yet. */
export const pendingSummaries = (list: readonly Entry[], summaries: Summaries, asked: ReadonlySet<string>) =>
  list
    .filter(entry => !(entry.kind === 'response' && entry.isLive) && isLong(entry.text))
    .map(entry => ({ hash: hashText(entry.text), text: entry.text, kind: entry.kind }))
    .filter(item => !(item.hash in summaries) && !asked.has(item.hash))
    .reverse()

/** What an entry shows for its text: its summary, else its first lines. */
export const displayText = (entry: Entry, summaries: Summaries) => {
  if (isLong(entry.text)) {
    const summary = summaries[hashText(entry.text)]
    if (summary) return { text: summary, isSummary: true }
  }
  const lines = shownLines(entry.text)
  const shown = lines.slice(0, SUMMARY_LINES).join(' ')
  const isCut = lines.length > SUMMARY_LINES || shown.length > SUMMARY_CHARS
  return { text: isCut ? `${shown.slice(0, SUMMARY_CHARS).trimEnd()} …` : shown, isSummary: false }
}

/** The prompt text to put back in the prompt box. */
export const promptLine = (entry: PromptEntry) =>
  entry.command ? `/${entry.command.name}${entry.command.args ? ` ${entry.command.args}` : ''}` : entry.text
