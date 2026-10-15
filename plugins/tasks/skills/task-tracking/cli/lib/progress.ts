// Edits to a progress log. Entries are append-only; only the `**Status:**` and
// `**Updated:**` mirror lines are ever rewritten.

export type Section = { start: number; end: number }

/** The `## <name>` section, also matching headings that add text after the name (`## name — notes`). */
export function findSection(lines: string[], name: string): Section | null {
  const head = new RegExp(`^## ${escapeRe(name)}(?:\\s*$|\\s+[—–:(-]|\\s+\`)`)
  const start = lines.findIndex(l => head.test(l))
  if (start < 0) return null
  let end = lines.length
  let fence = false
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i]!)) fence = !fence
    if (!fence && /^#{1,2} /.test(lines[i]!)) {
      end = i
      break
    }
  }
  return { start, end }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function formatEntry(date: string, text: string): string[] {
  const [first, ...rest] = text.trim().split('\n')
  return [`- ${date}: ${first}`, ...rest.map(l => (l.trim() === '' ? '' : `  ${l}`))]
}

export function newSection(name: string, status: string, date: string, entries: string[]): string[] {
  const head = [`## ${name}`, '', `**Status:** ${status}`, `**Updated:** ${date}`]
  return entries.length === 0 ? head : [...head, '', ...entries]
}

/** Append a dated entry to `name`'s section, creating the section at the end if absent. */
export function appendEntry(text: string, name: string, date: string, entry: string, status: string): string {
  const lines = splitLines(text)
  const entryLines = formatEntry(date, entry)
  const sec = findSection(lines, name)
  if (sec === null) return joinLines(appendBlock(lines, newSection(name, status, date, entryLines)))
  let last = sec.end
  while (last > sec.start + 1 && lines[last - 1]!.trim() === '') last--
  const prev = lines[last - 1]!
  const lead = prev.startsWith('## ') || /^\*\*(Status|Updated):\*\*/.test(prev) ? [''] : []
  const after = lines.slice(last)
  const updated = [...lines.slice(0, last), ...lead, ...entryLines, ...(after.length > 0 && after[0]!.trim() !== '' ? [''] : []), ...after]
  while (updated.length > 0 && updated[updated.length - 1]!.trim() === '') updated.pop()
  setMirror(updated, { start: sec.start, end: last + lead.length + entryLines.length }, 'Updated', date)
  return joinLines(updated)
}

/** Rewrite the section's `**Status:**` mirror if it has one. Returns null when the section is missing. */
export function setStatusMirror(text: string, name: string, status: string, date: string): string | null {
  const lines = splitLines(text)
  const sec = findSection(lines, name)
  if (sec === null) return null
  setMirror(lines, sec, 'Status', status)
  setMirror(lines, sec, 'Updated', date)
  return joinLines(lines)
}

function setMirror(lines: string[], sec: Section, label: string, value: string): void {
  const re = new RegExp(`^\\*\\*${label}:\\*\\*`)
  for (let i = sec.start + 1; i < sec.end; i++) {
    if (re.test(lines[i]!)) {
      lines[i] = `**${label}:** ${value}`
      return
    }
  }
}

/** Ensure a section exists, adding a stub at the end. */
export function ensureSection(text: string, name: string, status: string, date: string, goal: string): string {
  const lines = splitLines(text)
  if (findSection(lines, name) !== null) return text
  const entries = goal === '' ? [] : formatEntry(date, `filed. Goal: ${goal}`)
  return joinLines(appendBlock(lines, newSection(name, status, date, entries)))
}

/** Remove a section and return it with its heading renamed, for moving between files. */
export function takeSection(text: string, name: string, newName: string): { rest: string; section: string[] } | null {
  const lines = splitLines(text)
  const sec = findSection(lines, name)
  if (sec === null) return null
  const section = lines.slice(sec.start, sec.end)
  section[0] = section[0]!.replace(`## ${name}`, `## ${newName}`)
  while (section.length > 0 && section[section.length - 1]!.trim() === '') section.pop()
  const before = lines.slice(0, sec.start)
  const after = lines.slice(sec.end)
  if (after.length === 0) while (before.length > 0 && before[before.length - 1]!.trim() === '') before.pop()
  return { rest: joinLines([...before, ...after]), section }
}

export function renameSection(text: string, name: string, newName: string): string | null {
  const lines = splitLines(text)
  const sec = findSection(lines, name)
  if (sec === null) return null
  lines[sec.start] = lines[sec.start]!.replace(`## ${name}`, `## ${newName}`)
  return joinLines(lines)
}

export function appendBlock(lines: string[], block: string[]): string[] {
  const out = [...lines]
  while (out.length > 0 && out[out.length - 1]!.trim() === '') out.pop()
  if (out.length > 0) out.push('')
  return [...out, ...block]
}

export function epicLogHeader(project: string, epic: string): string {
  return [
    `# ${project} — ${epic} Progress Log`,
    '',
    `Execution log for the \`${epic}\` epic: what was done and how, key decisions, what`,
    'works, what doesn\'t. Task status lives in each task file\'s frontmatter; this file is',
    'the narrative beside it. Append entries (`tasks log <id> "…"`); don\'t rewrite earlier ones.',
    '',
    '## Epic summary',
    '',
    '_Nothing yet._',
    '',
  ].join('\n')
}

function splitLines(text: string): string[] {
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function joinLines(lines: string[]): string {
  return lines.join('\n') + '\n'
}
