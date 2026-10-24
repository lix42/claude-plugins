/** A slash command a prompt ran: `/name args`. */
export type CommandRef = { name: string; args: string }

/** How many times each tool ran in one response, by tool name. */
export type ToolTally = Record<string, number>

export type PromptEntry = {
  kind: 'prompt'
  id: string
  at: number
  text: string
  command: CommandRef | null
}

export type ResponseEntry = {
  kind: 'response'
  id: string
  at: number
  /** The response's final visible text; '' while it runs or when it had none. */
  text: string
  tools: ToolTally
  /** Skills the agent invoked, in order, each once. */
  skills: string[]
  /** Subagent types the agent spawned, in order, each once. */
  agents: string[]
  durationMs: number | null
  /** True while the turn runs: it is not summarized until it ends. */
  isLive: boolean
}

export type Entry = PromptEntry | ResponseEntry

/** A summary per text hash: the sentence, or null when the model gave none. */
export type Summaries = Record<string, string | null>

declare module 'claude-code' {
  interface PluginState {
    'session-compass': {
      entries: Entry[]
      summaries: Summaries
      /** The session's name as the transcript records it, or null for none yet. */
      name: string | null
      /** Where the session runs: the repo or folder, and the branch. */
      place: string
      accent: string
      /** The id of the prompt whose rewind/copy choice is shown. */
      confirming: string | null
      /** The last action's outcome, shown at the top until dismissed. */
      notice: string | null
      /** Whether the pane opened by itself once, so a closed pane stays closed. */
      autoOpened: boolean
      /**
       * The transcript's row count when a rewind was opened, or null for none:
       * before the next prompt the history is rebuilt if the rewind cut rows.
       */
      rowsAtRewind: number | null
      /** Whether the name and color editor under the session's name is open. */
      isEditing: boolean
    }
  }
}
