import type { MergeMethod, Notice, TrackedPr } from '../types'

/**
 * What the sync and action code needs from the engine. register.tsx builds it from `$`,
 * since the engine follows `$` only within the file that spells it.
 */
export type Io = {
  run: (argv: readonly string[], timeoutMs: number) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  now: () => Promise<number>
  getPrs: () => Promise<TrackedPr[]>
  updatePrs: (fn: (list: TrackedPr[]) => TrackedPr[]) => Promise<TrackedPr[]>
  updateSelected: (fn: (url: string | null) => string | null) => Promise<unknown>
  setBusy: (label: string | null) => Promise<unknown>
  setMethod: (url: string, method: MergeMethod) => Promise<unknown>
  toast: (text: string) => void
  notify: (text: string, title: string) => Promise<unknown>
  setNotice: (notice: Notice | null) => Promise<unknown>
  fill: (text: string) => Promise<boolean>
  /** Sends the agent a message, a turn of its own once the session is idle. */
  tellAgent: (text: string) => Promise<unknown>
  /** Whether PR activity is sent to the agent (`/pr agent on|off`). */
  getAgent: () => Promise<boolean>
  setAgent: (isOn: boolean) => Promise<unknown>
  /** Resolves whether the pane is drawn now, and why not when it waits. */
  openPane: () => Promise<{ isPlaced: boolean; reason?: string }>
  closePane: () => Promise<unknown>
}
