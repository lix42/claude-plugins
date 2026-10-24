import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Entry, PromptEntry, Summaries } from '../types'
import {
  addPrompt,
  finishResponse,
  fromMessages,
  pendingSummaries,
  promptLine,
  recordTool,
  settleLive,
  startResponse,
} from './history'
import { COLOR_NAMES, nameCommand, paletteAfter, paletteAt, parseColor, parseName, placeLine, rememberColor } from './identity'
import { SUMMARY_MODEL, cleanSummary, summaryPrompt } from './summarize'
import { contentKey, renderPane } from './view'

const PANE = 'session-compass'
/** The width asked for while docked; the person's own resize wins. */
const PANE_COLUMNS = 35
/** Summaries asked for per pass (one pass at the session's start and after each turn), so a resumed long session does not ask for hundreds at once. */
const SUMMARY_BATCH = 40
const MAX_SUMMARIES = 1_000
/** How long after a bare `/rename` (a generated name) the transcript is read for it. */
const RENAME_SETTLE_MS = 3_000

// Atoms live here: the engine reads which state a module touches from the file that spells `$`.
const entries = atom({ plugin: 'session-compass', key: 'entries' } as const, [] as Entry[])
const summaries = atom({ plugin: 'session-compass', key: 'summaries' } as const, {} as Summaries)
const name = atom({ plugin: 'session-compass', key: 'name' } as const, null as string | null)
const place = atom({ plugin: 'session-compass', key: 'place' } as const, '')
const accent = atom({ plugin: 'session-compass', key: 'accent' } as const, paletteAt(0))
const confirming = atom({ plugin: 'session-compass', key: 'confirming' } as const, null as string | null)
const notice = atom({ plugin: 'session-compass', key: 'notice' } as const, null as string | null)
const autoOpened = atom({ plugin: 'session-compass', key: 'autoOpened' } as const, false as boolean)
const rowsAtRewind = atom({ plugin: 'session-compass', key: 'rowsAtRewind' } as const, null as number | null)
const isEditing = atom({ plugin: 'session-compass', key: 'isEditing' } as const, false as boolean)

const STORE_COLORS = 'colors'
const STORE_NEXT = 'nextColor'
// Summaries outlive the process, so a resume in a new one does not ask for them all again.
const STORE_SUMMARIES = 'summaries'

/** The session's accent: the one the store keeps for its id, else the next of the palette. */
const resolveAccent = async ($: EngineInterface) => {
  const id = await $.session.id()
  const colors = ((await $.store.get(STORE_COLORS)) ?? {}) as Record<string, string>
  const kept = colors[id]
  if (kept) return kept
  const index = Number((await $.store.get(STORE_NEXT)) ?? 0)
  const color = paletteAt(index)
  await $.store.set(STORE_NEXT, index + 1)
  await $.store.set(STORE_COLORS, rememberColor(colors, id, color))
  return color
}

const setAccent = async ($: EngineInterface, color: string) => {
  const colors = ((await $.store.get(STORE_COLORS)) ?? {}) as Record<string, string>
  await $.store.set(STORE_COLORS, rememberColor(colors, await $.session.id(), color))
  await update($, accent, () => color)
}

const resolvePlace = async ($: EngineInterface) => {
  const root = await $.session.root()
  const repo = await $.session.repo()
  const branch = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 3_000 }).catch(() => null)
  return placeLine(root, repo?.name ?? null, branch?.exitCode === 0 ? branch.stdout.trim() || null : null)
}

/** Reads the name from the transcript, and retitles the pane's tab when it changed. */
const refreshName = async ($: EngineInterface) => {
  const ran = await $.process.run(nameCommand(await $.session.id()), { timeoutMs: 3_000 }).catch(() => null)
  const found = ran ? parseName(ran.stdout) : null
  if (found !== null && found !== (await read($, name))) await update($, name, () => found)
  // Even when the name stands, the tab may carry an older one (a name set before a reload).
  await retitle($, (await read($, name)) ?? 'Session')
}

/** Retitles the pane's tab when it is open and titled otherwise: another open of it only retitles. */
const retitle = async ($: EngineInterface, title: string) => {
  const pane = (await $.ui.panes()).find(open => open.id === PANE)
  // The width goes along: an open without it would ask for the default share again.
  if (pane && pane.title !== title) await $.ui.open({ id: PANE, title, columns: PANE_COLUMNS })
}

const rebuild = async ($: EngineInterface) => {
  const rows = await $.session.messages()
  await update($, entries, () => fromMessages(rows))
  await update($, rowsAtRewind, () => null)
}

/** Notes where the transcript stood when a rewind opened, so a cancelled one rebuilds nothing. */
const markRewind = async ($: EngineInterface) => {
  const rows = await $.session.messages()
  await update($, rowsAtRewind, () => rows.length)
}

/** After a rewind: rebuilt only if it cut the transcript, so a cancelled one keeps the entries' times. */
const settleRewind = async ($: EngineInterface) => {
  const before = await read($, rowsAtRewind)
  if (before === null) return
  if ((await $.session.messages()).length < before) await rebuild($)
  else await update($, rowsAtRewind, () => null)
}

/** A new conversation in this window (`/clear`, `/resume`): what the pane showed of the old one goes. */
const resetConversation = async ($: EngineInterface) => {
  await update($, entries, () => [])
  await update($, name, () => null)
  await update($, confirming, () => null)
  await update($, notice, () => null)
  await update($, isEditing, () => false)
  await update($, rowsAtRewind, () => null)
}

/** Loads the summaries the store keeps into the session's, the session's own winning. */
const loadSummaries = async ($: EngineInterface) => {
  const kept = ((await $.store.get(STORE_SUMMARIES)) ?? {}) as Summaries
  await update($, summaries, own => ({ ...kept, ...own }))
}

/** What the summary worker keeps between passes: the texts asked for, and whether a pass runs. */
type Worker = { asked: Set<string>; isRunning: boolean }

/** Summarizes the finished long texts not summarized yet, one at a time, newest first. */
const summarize = async ($: EngineInterface, worker: Worker) => {
  if (worker.isRunning) return
  worker.isRunning = true
  let isChanged = false
  try {
    const batch = pendingSummaries(await read($, entries), await read($, summaries), worker.asked).slice(0, SUMMARY_BATCH)
    for (const item of batch) {
      worker.asked.add(item.hash)
      const reply = await $.model.complete({ model: SUMMARY_MODEL, maxTokens: 80, ...summaryPrompt(item.kind, item.text) })
      // A failed call is not stored, so a reload asks again; an empty reply is, so it is not asked twice.
      if (!reply.isAnswered && reply.reason !== 'empty-reply') continue
      const sentence = reply.isAnswered ? cleanSummary(reply.text) : null
      await update($, summaries, all => Object.fromEntries(Object.entries({ ...all, [item.hash]: sentence }).slice(-MAX_SUMMARIES)))
      isChanged = true
    }
  } finally {
    worker.isRunning = false
    if (isChanged) await $.store.set(STORE_SUMMARIES, await read($, summaries)).catch(() => undefined)
  }
}

/** Whether the person left the pane at its end, and what the pane showed when it last followed it. */
type Follow = { isAtEnd: boolean; lastContent: string | null }

/** Keeps the newest entry in view, unless the person scrolled up to read older ones. */
const followEnd = async ($: EngineInterface, follow: Follow) => {
  try {
    if (!follow.isAtEnd || !(await $.ui.panes()).some(pane => pane.id === PANE)) return
    // `end` keeps up with the rows the drawing just added, so no wait for the redraw.
    const moved = await $.ui.scroll({ in: PANE, to: 'end' })
    // Shown while following is new, so a refusal is seen rather than guessed at.
    if (moved.deny && moved.deny !== 'the window moved meanwhile')
      await update($, notice, shown => shown ?? `Auto-scroll refused: ${moved.deny}`)
  } catch (error) {
    // Never over another notice: that one is what the person acted on.
    await update($, notice, shown => shown ?? `Auto-scroll failed: ${String(error)}`)
  }
}

const openPane = async ($: EngineInterface, follow: Follow) => {
  const opened = await $.ui.open({ id: PANE, title: (await read($, name)) ?? 'Session', columns: PANE_COLUMNS })
  if (!opened.isPlaced) return `Session compass is open but waits undrawn: ${opened.reason}`
  follow.isAtEnd = true
  follow.lastContent = null
  return 'Session compass opened.'
}

export const register: Register = on => {
  // Whether the terminal docks panes, seen while drawing; a module value, as drawing may not write state.
  let isFullscreen: boolean | undefined
  const worker: Worker = { asked: new Set(), isRunning: false }
  // A module value, so a reload starts it over and the first drawing follows the end again.
  const follow: Follow = { isAtEnd: true, lastContent: null }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'compass',
      description: 'Show the session compass pane, set its accent color (/compass color <name|#hex|next>), or rebuild its history (/compass resync)',
      argumentHint: '[color <name|#hex|next>|resync]',
    })
    void resolveAccent($).then(color => update($, accent, () => color))
    void resolvePlace($).then(line => update($, place, () => line))
    void refreshName($)
    // A resumed session, or a process that restarted: the history comes from the transcript.
    if ((await read($, entries)).length === 0) await rebuild($)
    else await update($, entries, settleLive)
    await loadSummaries($)
    void summarize($, worker)
    return started
  }).catch(($, e, next) => next(e))

  // `/clear` and `/resume` end one conversation and start another in the same process.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') await resetConversation($)
    return next(e)
  }).catch(($, e, next) => next(e))

  // The new conversation's start: `/clear` keeps the window's color, `/resume` takes the resumed session's.
  on('classic.SessionStart', async ($, e, next) => {
    const started = await next(e)
    if (e.source === 'clear') {
      await setAccent($, await read($, accent))
      await retitle($, 'Session')
    } else if (e.source === 'resume') {
      await resetConversation($)
      await update($, accent, () => '')
      void resolveAccent($).then(color => update($, accent, () => color))
      await rebuild($)
      await retitle($, 'Session')
      void refreshName($)
      void summarize($, worker)
    }
    if (e.source === 'clear' || e.source === 'resume') void resolvePlace($).then(line => update($, place, () => line))
    return started
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    if (e.isMeta) return next(e)
    await settleRewind($)
    const at = await $.clock.now()
    const prompt: PromptEntry = {
      kind: 'prompt',
      id: `p-${at}`,
      at,
      text: e.command ? '' : e.text.trim(),
      command: e.command ? { name: e.command.name, args: e.command.args.trim() } : null,
    }
    await update($, entries, list => addPrompt(list, prompt))
    // Opened by itself once, after the first prompt, and only where it docks beside the transcript.
    if (isFullscreen === true && !(await read($, autoOpened))) {
      await update($, autoOpened, () => true)
      void openPane($, follow)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, entries, list => startResponse(settleLive(list), `r-${e.turnId}`, Date.now()))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (e.agentId === undefined) await update($, entries, list => recordTool(list, e.tool, e as { skill?: unknown; subagent_type?: unknown }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      await update($, entries, list => finishResponse(list, e.answer, e.durationMs))
      void refreshName($)
      // A turn may have switched branches (`git checkout -b`) or worktrees.
      void resolvePlace($).then(line => update($, place, () => line))
      void summarize($, worker)
    }
    return done
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'rename' }, async ($, e, next) => {
    const ran = await next(e)
    const given = e.args.trim()
    if (given) {
      // Taken as given: the transcript may not hold it yet, and reading it now would bring the old title back.
      await update($, name, () => given)
      await retitle($, given)
    } else {
      // A bare /rename generates a name: read it once the transcript has it.
      void $.clock.sleep(RENAME_SETTLE_MS).then(() => refreshName($))
    }
    return ran
  }).catch(($, e, next) => next(e))

  // A rewind cuts the conversation: the history is rebuilt from the transcript before the next prompt.
  on('command.run', { command: 'rewind' }, async ($, e, next) => {
    await markRewind($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'compass' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    if (verb === 'color') {
      const arg = rest.join(' ')
      if (arg === 'next' || arg === '') {
        // The color after this session's own; the counter is new sessions' alone.
        const color = paletteAfter(await read($, accent))
        await setAccent($, color)
        return { text: `Accent color set to ${color}.` }
      }
      const color = parseColor(arg)
      if (!color) return { text: `Not a color: "${arg}". Use a hex color (#3b82f6) or one of: ${COLOR_NAMES.join(', ')}.` }
      await setAccent($, color)
      return { text: `Accent color set to ${color}.` }
    }
    if (verb === 'resync') {
      await rebuild($)
      void summarize($, worker)
      return { text: 'Session compass history rebuilt from the transcript.' }
    }
    if (verb !== '') return { text: `Unknown option "${verb}". Try /compass, /compass color <name|#hex|next> or /compass resync.` }
    return { text: await openPane($, follow) }
  }).catch(() => ({ text: 'session-compass: /compass failed; see the debug log.' }))

  // Only to learn whether panes dock; the hint is drawn as the engine has it.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    // The terminal's alone: another attached surface (the desktop, mobile) says nothing of where the terminal docks.
    if (e.surface === 'terminal' && e.viewport?.isFullscreen !== undefined) isFullscreen = e.viewport.isFullscreen
    return next(e)
  })

  // The person's scrolling says whether to follow new entries: at the end, yes; scrolled up, no.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const moved = await next(e)
    if (e.origin.kind === 'person' && !moved.deny) follow.isAtEnd = e.offset >= e.contentRows - e.bodyRows
    return moved
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const model = {
      name: await read($, name),
      place: await read($, place),
      accent: (await read($, accent)) || paletteAt(0),
      entries: await read($, entries),
      summaries: await read($, summaries),
      confirming: await read($, confirming),
      notice: await read($, notice),
      isEditing: await read($, isEditing),
    }
    // Whatever changed what the pane shows, the end follows; a scroll alone redraws the same content.
    const content = contentKey(model)
    if (content !== follow.lastContent) {
      follow.lastContent = content
      void followEnd($, follow)
    }
    return renderPane(
      $.ui.resolve(e),
      model,
      {
        select: id => void update($, confirming, current => (current === id ? null : id)),
        cancel: () => void update($, confirming, () => null),
        dismissNotice: () => void update($, notice, () => null),
        toggleEditor: () => {
          // The editor opens under the name, at the pane's end: follow it there.
          follow.isAtEnd = true
          void update($, isEditing, open => !open)
        },
        rename: text =>
          void (async () => {
            const given = text.trim()
            if (!given || given === (await read($, name))) return
            // Claude Code's own /rename, so the transcript and the session list carry the name too.
            const ran = await $.command
              .run({ command: 'rename', args: given })
              .catch((error: unknown) => ({ text: `Could not rename: ${String(error)}` }))
            if (ran.text?.startsWith('Could not')) return void (await update($, notice, () => ran.text ?? null))
            await update($, name, () => given)
            await retitle($, given)
          })(),
        pickColor: text =>
          void (async () => {
            const color = parseColor(text)
            if (!color) return void (await update($, notice, () => `Not a color: "${text}". Use a hex color like #ff6b6b.`))
            await setAccent($, color)
          })(),
        copy: entry =>
          void (async () => {
            await update($, confirming, () => null)
            const filled = await $.prompt.fill({ text: promptLine(entry), mode: 'replace' })
            if (!filled.isFilled) await update($, notice, () => 'Could not put the prompt in the prompt box.')
          })(),
        rewind: () =>
          void (async () => {
            await update($, confirming, () => null)
            await markRewind($)
            // Opens Claude Code's own rewind picker: a mod cannot pick the message for it.
            const ran = await $.command
              .run({ command: 'rewind' })
              .catch((error: unknown) => ({ text: `Could not open /rewind: ${String(error)}` }))
            if (ran.text?.startsWith('Could not')) await update($, notice, () => ran.text ?? null)
          })(),
      },
    )
  })
}
