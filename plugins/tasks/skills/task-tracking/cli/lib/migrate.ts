// One-shot conversion of a pre-frontmatter plan (status and edges in TASKS.md) into
// frontmatter task files. It never drops text: whatever it cannot map into a field is
// kept in the task body and listed in the report.

import { dependencySectionIds } from './links.ts'
import { cmp, splitId, STATUSES } from './model.ts'
import type { Epic, Mode, Plan, Priority, Status, Task } from './model.ts'
import { splitFrontmatter } from './frontmatter.ts'

export type LegacyInput = {
  mode: Mode
  tasksMd: string
  /** Every task file, by id. */
  files: { id: string; text: string }[]
  /** Epic directories, for epic mode. */
  epicDirs: string[]
  today: string
}

export type MigrateReport = {
  mode: Mode
  total: number
  counts: Record<Status, number>
  depsSource: { list: number; clause: number; file: number; none: number }
  /** Listed in TASKS.md without a file: a stub file is created. */
  stubs: string[]
  /** Files TASKS.md never lists: migrated as `closed`. */
  unlisted: string[]
  /** Already carry frontmatter: left untouched. */
  alreadyMigrated: string[]
  duplicates: string[]
  /** List-like lines that matched no known shape. */
  unparsed: { line: number; text: string }[]
  /** The kept dependency source disagrees with the file's `## Dependencies` links. */
  disagreements: { id: string; kept: string[]; file: string[] }[]
  /** "Depends: none …" clauses whose ids were not kept as deps. */
  noneClauses: { id: string; text: string }[]
  epicsWithoutHeading: string[]
  /** Tasks whose list text was moved into the body as a note. */
  notes: number
}

export type MigrateResult = { plan: Plan; report: MigrateReport; changed: Set<string> }

type Item = {
  id: string
  listTitle: string
  box: string
  rest: string
  line: number
}

type DepEntry = { id: string; deps: string[]; annotation: string; note: string }

type Parsed = {
  header: string
  items: Item[]
  depList: Map<string, DepEntry>
  epics: { name: string; blurb: string }[]
  unparsed: { line: number; text: string }[]
}

const ITEM = /^(?:- )?\[([ ~xX-])\] (.*)$/
const EPIC_HEAD = /^### ([a-z0-9][a-z0-9-]*)\s+[—–-]\s+\[progress\]/
const DEP_ENTRY = /^- `([^`]+)`(?: \((.*?)\))?:\s*(.*)$/

export function parseLegacyIndex(text: string): Parsed {
  const lines = text.split('\n')
  const header: string[] = []
  const items: Item[] = []
  const depList = new Map<string, DepEntry>()
  const epics: { name: string; blurb: string }[] = []
  const unparsed: { line: number; text: string }[] = []
  let inHeader = true
  let section = ''
  let fence = false
  let epicBlurb: string[] | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^\s*```/.test(line)) fence = !fence
    const h2 = /^## (.*)$/.exec(line)
    const isItem = !fence && ITEM.test(line)
    if (inHeader && ((h2 && !/^Design\b/.test(h2[1]!)) || isItem || EPIC_HEAD.test(line))) inHeader = false
    if (inHeader) {
      if (!/^\*\*Legend:?\*\*/.test(line)) header.push(line)
      continue
    }
    if (fence) continue
    if (h2) {
      section = h2[1]!.trim()
      epicBlurb = null
      continue
    }
    const epic = EPIC_HEAD.exec(line)
    if (epic) {
      epicBlurb = []
      epics.push({ name: epic[1]!, blurb: '' })
      continue
    }
    if (epicBlurb !== null) {
      if (line.startsWith('>')) {
        epicBlurb.push(line.replace(/^> ?/, ''))
        epics[epics.length - 1]!.blurb = epicBlurb.join('\n').trim()
        continue
      }
      epicBlurb = null
    }
    if (/^Dependencies\b/.test(section)) {
      const dep = DEP_ENTRY.exec(line)
      if (!dep) continue
      let rest = dep[3]!
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]!)) rest = join(rest, lines[++i]!.trim())
      const [deps, note] = splitDepRest(rest)
      if (!depList.has(dep[1]!)) depList.set(dep[1]!, { id: dep[1]!, deps, annotation: dep[2] ?? '', note })
      continue
    }
    const m = ITEM.exec(line)
    if (!m) {
      if (/^\s*[-*]?\s*\[[^\]]?\]\s/.test(line)) unparsed.push({ line: i + 1, text: line })
      continue
    }
    let body = m[2]!
    while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]!) && !ITEM.test(lines[i + 1]!.trim())) {
      i++
      body += ' ' + lines[i]!.trim()
    }
    const item = parseItem(m[1]!, body, i + 1)
    if (item) items.push(item)
    else unparsed.push({ line: i + 1, text: line })
  }
  while (header.length > 0 && /^(\s*|---)$/.test(header[header.length - 1]!)) header.pop()
  return { header: header.join('\n'), items, depList, epics, unparsed }
}

function parseItem(box: string, text: string, line: number): Item | null {
  const linked = /^\[(.*?)\]\(tasks\/([^)\s]+)\.md\)\s*(.*)$/.exec(text)
  if (linked) return { id: linked[2]!, listTitle: linked[1]!, box, rest: stripLead(linked[3]!), line }
  const bare = /^([a-z0-9][a-z0-9/-]*):\s*(.*)$/.exec(text)
  if (bare) return { id: bare[1]!, listTitle: '', box, rest: bare[2]!.trim(), line }
  return null
}

function stripLead(s: string): string {
  return s.replace(/^[—–:-]\s*/, '').trim()
}

function splitDepRest(rest: string): [string[], string] {
  const at = rest.search(/(?:^|\s+)[—–]\s+/)
  const head = at < 0 ? rest : rest.slice(0, at)
  const note = at < 0 ? '' : rest.slice(at).replace(/^\s*[—–]\s+/, '')
  if (/^\(none\)/i.test(head.trim())) return [[], join(head.trim().replace(/^\(none\)\s*/i, ''), note)]
  const ids = [...head.matchAll(/`([^`]+)`/g)].map(m => m[1]!)
  const leftover = head.replace(/`[^`]+`/g, '').replace(/[,\s]+/g, ' ').trim()
  return [ids, join(leftover, note)]
}

function join(a: string, b: string): string {
  return [a, b].filter(s => s !== '').join(' ')
}

const DEPENDS = /\s*Depends(?:\s*\((hard|soft)\))?:\s*((?:[^.]|\.(?=\S))*)\.?/gi
const CLOSED_LEAD = /^(?:\*\*)?\s*(?:closed|superseded|retired|absorbed|folded|merged|moot|dropped|obsolete)\b/i
const CLOSED_INTO =
  /(?:folded|merged|absorbed|superseded)\**\s*(?:\([^)]*\)\s*|\d{4}-\d{2}-\d{2}\s+)?(?:into|by)\s+`?([a-z0-9][a-z0-9/-]*[a-z0-9])`?/i
const BANNER = /^>\s*\*\*(?:superseded|retired|closed|moot|obsolete|dropped)\b/im

type Clause = { hard: string[]; soft: string[]; none: string }

function parseClauses(rest: string, known: ReadonlySet<string>): { text: string; clause: Clause | null } {
  let clause: Clause | null = null
  const text = rest.replace(DEPENDS, (_whole, kind: string | undefined, body: string) => {
    clause ??= { hard: [], soft: [], none: '' }
    const ids = mentionedIds(body, known)
    if (/^none\b/i.test(body.trim())) {
      const soft = /\bsoft\b/i.test(body) ? ids : []
      clause.soft.push(...soft)
      clause.none = join(clause.none, `Depends: ${body.trim()}`)
    } else if (kind?.toLowerCase() === 'soft') {
      clause.soft.push(...ids)
    } else {
      clause.hard.push(...ids)
    }
    return ''
  })
  return { text: text.trim(), clause }
}

function mentionedIds(text: string, known: ReadonlySet<string>): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/[a-z0-9][a-z0-9/-]*[a-z0-9]/g)) if (known.has(m[0]) && !out.includes(m[0])) out.push(m[0])
  return out
}

const PRIORITY_MARK = /\*\*(?:low priority|blocked)\*\*\s*[:—–-]?\s*|\b(?:deferred\s*\/\s*)?lower priority\b\s*[:—–-]?\s*/gi
const DONE_LEAD = /^\*\*done(?:\s+(\d{4}-\d{2}-\d{2}))?\s*[:—–-]?\s*(.*?)\*\*/i

/** A one-line summary: the list text up to its status narrative, cut at the first clause break. */
export function summarize(rest: string): string {
  let s = rest.replace(PRIORITY_MARK, '').trim()
  const lead = DONE_LEAD.exec(s)
  if (lead) s = lead[2]!.trim() || s.slice(lead[0].length).trim()
  const cut = s.search(/\s*(?:[.;,]\s*)?\*\*(?:done|closed)\b/i)
  if (cut >= 0) s = s.slice(0, cut).trim()
  if (CLOSED_LEAD.test(s)) return ''
  const brk = /(?<=.{12,}?)(?:;\s|\.\s|\s[—–]\s)/.exec(s)
  if (brk) s = s.slice(0, brk.index)
  s = s.replace(/[\s.,;:—–-]+$/, '').replace(/^\*\*(.*)\*\*$/, '$1')
  if (s.length > 200) s = s.slice(0, s.lastIndexOf(' ', 197)) + '…'
  return s
}

/** The completion date a list item states (`**Done 2026-09-24**`). */
export function doneDate(rest: string): string {
  return /\*\*done\s+(\d{4}-\d{2}-\d{2})/i.exec(rest)?.[1] ?? ''
}

function annotationTags(annotation: string): { tags: string[]; rest: string } {
  const tags: string[] = []
  const rest: string[] = []
  for (const raw of annotation.split(/[;,]/)) {
    const seg = raw.trim()
    if (seg === '') continue
    if (/^[A-Za-z][A-Za-z -]{0,24}$/.test(seg) && !CLOSED_LEAD.test(seg)) tags.push(seg.toLowerCase().replace(/\s+/g, '-'))
    else rest.push(seg)
  }
  return { tags, rest: rest.join('; ') }
}

function stubTitle(rest: string): string {
  let s = summarize(rest)
  const paren = s.indexOf(' (')
  if (paren > 20) s = s.slice(0, paren)
  if (s.length <= 80) return s
  const comma = s.lastIndexOf(', ', 80)
  return comma > 20 ? s.slice(0, comma) : s.slice(0, s.lastIndexOf(' ', 77)) + '…'
}

function fileTitle(body: string): string {
  return /^# (.+?)\s*$/m.exec(body)?.[1] ?? ''
}

function fileDepIds(id: string, body: string, ids: ReadonlySet<string>): string[] | null {
  return dependencySectionIds(id, body)?.filter(d => ids.has(d)) ?? null
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every(x => b.includes(x))
}

function insertNote(body: string, note: string[]): string {
  if (note.length === 0) return body
  const block = note.flatMap((l, i) => (i === 0 ? [`> ${l}`] : ['>', `> ${l}`])).join('\n') + '\n\n'
  const h1 = /^# .*\n\n?/.exec(body)
  if (!h1) return block + body
  return body.slice(0, h1[0].length) + (h1[0].endsWith('\n\n') ? '' : '\n') + block + body.slice(h1[0].length)
}

export function migrate(input: LegacyInput): MigrateResult {
  const parsed = parseLegacyIndex(input.tasksMd)
  const files = new Map(input.files.map(f => [f.id, f.text]))
  const report: MigrateReport = {
    mode: input.mode,
    total: 0,
    counts: Object.fromEntries(STATUSES.map(s => [s, 0])) as Record<Status, number>,
    depsSource: { list: 0, clause: 0, file: 0, none: 0 },
    stubs: [],
    unlisted: [],
    alreadyMigrated: [],
    duplicates: [],
    unparsed: parsed.unparsed,
    disagreements: [],
    noneClauses: [],
    epicsWithoutHeading: [],
    notes: 0,
  }
  const items = new Map<string, Item>()
  for (const it of parsed.items) {
    if (items.has(it.id)) report.duplicates.push(it.id)
    else items.set(it.id, it)
  }
  const ids = new Set([...items.keys(), ...files.keys()])
  const tasks: Task[] = []
  const changed = new Set<string>()

  for (const id of [...ids].sort(cmp)) {
    const text = files.get(id)
    if (text !== undefined && splitFrontmatter(text).fields !== null) {
      report.alreadyMigrated.push(id)
      continue
    }
    const { epic, name } = splitId(id)
    const item = items.get(id)
    const dep = parsed.depList.get(id)
    const { text: rest, clause } = parseClauses(item?.rest ?? '', ids)
    const body0 = text ?? `# ${item?.listTitle || stubTitle(rest) || name}\n\n## Goal\n\n${rest || 'TODO'}\n`
    if (text === undefined) report.stubs.push(id)
    if (item === undefined) report.unlisted.push(id)

    const status = statusOf(item, rest, body0)
    const closedInto = status === 'closed' ? closedTarget(`${rest} ${dep?.annotation ?? ''} ${banner(body0)}`, ids, id) : ''
    const { tags, rest: annotationRest } = annotationTags(dep?.annotation ?? '')
    const fileDeps = text === undefined ? null : fileDepIds(id, text, ids)

    let deps: string[]
    if (item === undefined) {
      // Unlisted files are closed history; their links stay as prose.
      deps = []
      report.depsSource.none++
    } else if (dep) {
      deps = dep.deps
      report.depsSource.list++
    } else if (clause && (clause.hard.length > 0 || clause.none !== '')) {
      deps = clause.hard
      report.depsSource.clause++
    } else if (fileDeps && fileDeps.length > 0) {
      deps = fileDeps
      report.depsSource.file++
    } else {
      deps = []
      report.depsSource.none++
    }
    if (item !== undefined && fileDeps !== null && (dep || clause) && !sameSet(deps, fileDeps))
      report.disagreements.push({ id, kept: deps, file: fileDeps })
    if (clause?.none) report.noneClauses.push({ id, text: clause.none })

    const title = (fileTitle(body0) || item?.listTitle || name).replace(new RegExp(`^${name}:\\s+`), '')
    const summary0 = summarize(rest)
    const summary = summary0.toLowerCase() === title.toLowerCase() ? '' : summary0
    const note: string[] = []
    if (rest !== '' && rest.replace(/[\s.]+$/, '') !== summary0) note.push(`**From TASKS.md** (migrated ${input.today}): ${rest}`)
    const depNote = join(annotationRest, dep?.note && rest.includes(dep.note) ? '' : dep?.note ?? '')
    if (depNote !== '') note.push(`**Dependency note** (migrated ${input.today}): ${depNote}`)
    if (clause?.none) note.push(`**Dependency note** (migrated ${input.today}): ${clause.none}`)
    if (note.length > 0) report.notes++

    tasks.push({
      id,
      epic,
      name,
      title,
      status,
      deps,
      related: clause ? clause.soft.filter(s => !deps.includes(s)) : [],
      priority: priorityOf(rest),
      tags,
      summary,
      done: status === 'done' ? doneDate(rest) : '',
      closedInto,
      body: insertNote(body0, note),
    })
    changed.add(id)
    report.counts[status]++
  }
  report.total = tasks.length + report.alreadyMigrated.length

  const epics: Epic[] = []
  if (input.mode === 'epic') {
    parsed.epics.forEach((e, i) => epics.push({ name: e.name, title: e.name, order: i + 1, blurb: e.blurb }))
    for (const dir of [...input.epicDirs].sort(cmp)) {
      if (epics.some(e => e.name === dir)) continue
      report.epicsWithoutHeading.push(dir)
      epics.push({ name: dir, title: dir, order: epics.length + 1, blurb: '' })
    }
  }
  return { plan: { mode: input.mode, header: parsed.header, epics, tasks }, report, changed }
}

function statusOf(item: Item | undefined, rest: string, body: string): Status {
  if (item === undefined) return 'closed'
  if (item.box === '-') return 'closed'
  if (item.box === '~') return 'doing'
  if (item.box === ' ') return 'todo'
  return CLOSED_LEAD.test(rest) || BANNER.test(body.slice(0, 600)) ? 'closed' : 'done'
}

function banner(body: string): string {
  return BANNER.test(body.slice(0, 600)) ? body.slice(0, 600) : ''
}

function closedTarget(text: string, ids: ReadonlySet<string>, self: string): string {
  const m = CLOSED_INTO.exec(text)
  return m && ids.has(m[1]!) && m[1] !== self ? m[1]! : ''
}

function priorityOf(rest: string): Priority | null {
  if (/\*\*blocked\*\*/i.test(rest)) return 'blocked'
  if (/\blow(?:er)? priority\b/i.test(rest)) return 'low'
  return null
}
