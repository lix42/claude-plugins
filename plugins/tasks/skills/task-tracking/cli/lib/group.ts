// Promote a flat plan to epics: every task gets an `<epic>/<name>` id, links follow,
// and progress.md splits into progress/<epic>.md. Log entries move verbatim.

import { rewriteLinks } from './links.ts'
import { ID_PART, taskPath } from './model.ts'
import type { Epic, Plan, Task } from './model.ts'
import type { Result } from './ops.ts'
import { epicLogHeader, ensureSection } from './progress.ts'
import { STATUS_WORD } from './model.ts'

/** A task stays `name`, or is renamed with `{ from, name }` (e.g. to strip a prefix the epic now says). */
export type GroupEntry = string | { from: string; name: string }
export type GroupMap = { epics: { name: string; title?: string; blurb?: string; tasks: GroupEntry[] }[] }

export type Grouped = {
  plan: Plan
  /** Old task path → new, docs-relative. */
  moves: Map<string, string>
  /** New progress files, docs-relative path → text. */
  logs: Map<string, string>
  /** Section headings from progress.md that name no task. */
  unassigned: string[]
}

export function parseGroupMap(json: string): Result<GroupMap> {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (e) {
    return { ok: false, errors: [`map is not JSON: ${(e as Error).message}`] }
  }
  const epics = (raw as { epics?: unknown }).epics
  if (!Array.isArray(epics)) return { ok: false, errors: ['map needs an `epics` array'] }
  const errors: string[] = []
  for (const e of epics as Record<string, unknown>[]) {
    const entryOk = (t: unknown): boolean =>
      typeof t === 'string' || (typeof t === 'object' && t !== null && typeof (t as { from?: unknown }).from === 'string' && typeof (t as { name?: unknown }).name === 'string')
    if (typeof e.name !== 'string' || !Array.isArray(e.tasks) || !e.tasks.every(entryOk))
      errors.push('each epic needs a `name` and a `tasks` array of names or `{ "from", "name" }` renames')
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: raw as GroupMap }
}

export function planGroup(plan: Plan, map: GroupMap, progress: string | null, project: string, date: string): Result<Grouped> {
  const errors: string[] = []
  if (plan.mode !== 'flat') errors.push('the plan already uses epics; move tasks one at a time with `tasks mv`')
  const epicOf = new Map<string, string>()
  const nameOf = new Map<string, string>()
  const taken = new Map<string, string>()
  for (const e of map.epics) {
    if (!ID_PART.test(e.name)) errors.push(`invalid epic name \`${e.name}\``)
    for (const entry of e.tasks) {
      const [from, name] = typeof entry === 'string' ? [entry, entry] : [entry.from, entry.name]
      if (epicOf.has(from)) errors.push(`\`${from}\` is assigned to both \`${epicOf.get(from)}\` and \`${e.name}\``)
      if (!ID_PART.test(name)) errors.push(`invalid task name \`${name}\``)
      const id = `${e.name}/${name}`
      if (taken.has(id)) errors.push(`\`${from}\` and \`${taken.get(id)}\` would both become \`${id}\``)
      taken.set(id, from)
      epicOf.set(from, e.name)
      nameOf.set(from, name)
    }
  }
  const names = new Set(plan.tasks.map(t => t.id))
  for (const t of epicOf.keys()) if (!names.has(t)) errors.push(`unknown task \`${t}\``)
  for (const t of names) if (!epicOf.has(t)) errors.push(`\`${t}\` is not assigned to an epic`)
  if (errors.length > 0) return { ok: false, errors }

  const newId = (id: string): string => `${epicOf.get(id)}/${nameOf.get(id)}`
  const moves = new Map(plan.tasks.map(t => [taskPath(t.id), taskPath(newId(t.id))]))
  const tasks: Task[] = plan.tasks.map(t => {
    const id = newId(t.id)
    return {
      ...t,
      id,
      epic: epicOf.get(t.id)!,
      name: nameOf.get(t.id)!,
      deps: t.deps.map(d => (names.has(d) ? newId(d) : d)),
      related: t.related.map(d => (names.has(d) ? newId(d) : d)),
      closedInto: t.closedInto !== '' && names.has(t.closedInto) ? newId(t.closedInto) : t.closedInto,
      body: rewriteLinks(t.body, 'tasks', `tasks/${epicOf.get(t.id)}`, moves),
    }
  })
  const epics: Epic[] = map.epics.map((e, i) => ({
    name: e.name,
    title: e.title ?? e.name,
    order: i + 1,
    blurb: e.blurb ?? '',
  }))

  const { logs, unassigned } = splitLog(progress ?? '', epicOf, nameOf, map.epics.map(e => e.name), project, moves)
  seedStubs(logs, tasks, date)
  return { ok: true, value: { plan: { ...plan, mode: 'epic', epics, tasks }, moves, logs, unassigned } }
}

function splitLog(
  text: string,
  epicOf: ReadonlyMap<string, string>,
  nameOf: ReadonlyMap<string, string>,
  epicNames: string[],
  project: string,
  moves: ReadonlyMap<string, string>,
): { logs: Map<string, string>; unassigned: string[] } {
  const lines = text.split('\n')
  const preamble: string[] = []
  const sections: { heading: string; lines: string[] }[] = []
  let fence = false
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (!fence && line.startsWith('## ')) sections.push({ heading: line, lines: [line] })
    else (sections[sections.length - 1]?.lines ?? preamble).push(line)
  }
  const byEpic = new Map<string, string[][]>(epicNames.map(e => [e, []]))
  const unassignedSecs: string[][] = []
  const unassigned: string[] = []
  for (const s of sections) {
    const name = /^## ([a-z0-9][a-z0-9-]*)(?=\s|$)/.exec(s.heading)?.[1]
    const epic = name === undefined ? undefined : epicOf.get(name)
    // The log moves from docs/ into docs/progress/, so its relative links re-base.
    const body = trimEnd(rewriteLinks(s.lines.join('\n'), '', 'progress', moves).split('\n'))
    if (epic === undefined) {
      unassignedSecs.push(body)
      unassigned.push(s.heading)
    } else {
      body[0] = body[0]!.replace(`## ${name}`, `## ${nameOf.get(name!)}`)
      byEpic.get(epic)!.push(body)
    }
  }
  const logs = new Map<string, string>()
  for (const [epic, secs] of byEpic) {
    logs.set(`progress/${epic}.md`, [epicLogHeader(project, epic).replace(/\n+$/, ''), ...secs.map(s => s.join('\n'))].join('\n\n') + '\n')
  }
  // The old log's own header and intro, kept so nothing in it is lost.
  const intro = trimEnd(rewriteLinks(preamble.join('\n'), '', 'progress', moves).split('\n'))
  while (intro.length > 0 && intro[0]!.trim() === '') intro.shift()
  if (intro.length > 0) {
    unassignedSecs.unshift(['## Original progress.md preamble', '', ...intro.map(l => l.replace(/^(#{1,2}) /, '##$1 '))])
    unassigned.unshift('(preamble)')
  }
  if (unassignedSecs.length > 0) {
    const head = `# ${project} — Unassigned Progress\n\nSections from the flat progress log that name no task, kept verbatim.`
    logs.set('progress/_unassigned.md', [head, ...unassignedSecs.map(s => s.join('\n'))].join('\n\n') + '\n')
  }
  return { logs, unassigned }
}

/** Give every open task a section to log into, as setup does. */
function seedStubs(logs: Map<string, string>, tasks: Task[], date: string): void {
  for (const t of tasks) {
    if (t.status !== 'todo' && t.status !== 'doing') continue
    const path = `progress/${t.epic}.md`
    logs.set(path, ensureSection(logs.get(path) ?? '', t.name, STATUS_WORD[t.status], date, t.summary))
  }
}

function trimEnd(lines: string[]): string[] {
  const out = [...lines]
  while (out.length > 0 && out[out.length - 1]!.trim() === '') out.pop()
  return out
}
