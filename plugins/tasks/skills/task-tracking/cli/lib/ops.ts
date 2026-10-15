// Pure edits to tasks. Callers write the results.

import { wouldCycle } from './graph.ts'
import type { Index } from './graph.ts'
import { dirOf, relativeTo, rewriteLinks } from './links.ts'
import { isValidId, PRIORITIES, splitId, STATUSES, taskPath } from './model.ts'
import type { Mode, Plan, Priority, Status, Task } from './model.ts'

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] }

const SCALARS = ['title', 'status', 'priority', 'summary', 'done', 'closed_into'] as const
const LISTS = ['deps', 'related', 'tags'] as const
type ListKey = (typeof LISTS)[number]

/** Apply `key=value`, `list+=a,b` and `list-=a` assignments. */
export function applySet(task: Task, assignments: string[], idx: Index): Result<Task> {
  const t: Task = { ...task, deps: [...task.deps], related: [...task.related], tags: [...task.tags] }
  const errors: string[] = []
  for (const a of assignments) {
    const m = /^([a-z_]+)(\+=|-=|=)(.*)$/s.exec(a)
    if (!m) {
      errors.push(`expected key=value, key+=value or key-=value; got \`${a}\``)
      continue
    }
    const [, key, op, raw] = m as unknown as [string, string, string, string]
    if ((LISTS as readonly string[]).includes(key)) {
      const k = key as ListKey
      const vals = raw.split(',').map(s => s.trim()).filter(s => s !== '')
      if (op === '=') t[k] = dedupe(vals)
      else if (op === '+=') t[k] = dedupe([...t[k], ...vals])
      else t[k] = t[k].filter(v => !vals.includes(v))
      continue
    }
    if (op !== '=') {
      errors.push(`\`${key}\` is not a list; use ${key}=value`)
      continue
    }
    const v = raw.trim()
    if (/[\r\n\u2028\u2029]/.test(v)) {
      errors.push(`\`${key}\` must be one line`)
      continue
    }
    switch (key as (typeof SCALARS)[number]) {
      case 'title':
        if (v === '') errors.push('`title` cannot be empty')
        else t.title = v
        break
      case 'status':
        if ((STATUSES as readonly string[]).includes(v)) t.status = v as Status
        else errors.push(`\`status\` must be one of ${STATUSES.join(', ')}`)
        break
      case 'priority':
        if (v === '' || v === 'none') t.priority = null
        else if ((PRIORITIES as readonly string[]).includes(v)) t.priority = v as Priority
        else errors.push(`\`priority\` must be one of ${PRIORITIES.join(', ')} or none`)
        break
      case 'summary':
        t.summary = v
        break
      case 'done':
        t.done = v
        break
      case 'closed_into':
        t.closedInto = v
        break
      default:
        errors.push(`unknown key \`${key}\`; known: ${[...SCALARS, ...LISTS].join(', ')}`)
    }
  }
  errors.push(...refErrors(t, idx))
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: t }
}

function refErrors(t: Task, idx: Index): string[] {
  const errors: string[] = []
  for (const d of [...t.deps, ...t.related]) if (!idx.has(d)) errors.push(`unknown task \`${d}\``)
  if (t.closedInto !== '' && !idx.has(t.closedInto)) errors.push(`unknown task \`${t.closedInto}\``)
  for (const d of t.deps) if (idx.has(d) && wouldCycle(t.id, d, idx)) errors.push(`\`${d}\` would close a dependency cycle`)
  return errors
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)]
}

export type NewOpts = { title: string; summary: string; deps: string[]; related: string[]; priority: Priority | null }

export function newTask(id: string, mode: Mode, opts: NewOpts, idx: Index): Result<Task> {
  const errors: string[] = []
  if (!isValidId(id, mode))
    errors.push(`invalid id \`${id}\`: use ${mode === 'flat' ? '`<name>`' : '`<epic>/<name>`'} in kebab-case`)
  if (idx.has(id)) errors.push(`\`${id}\` already exists`)
  if (opts.title.trim() === '') errors.push('`--title` is required')
  if (/[\r\n\u2028\u2029]/.test(opts.title + opts.summary)) errors.push('`--title` and `--summary` must be one line')
  const { epic, name } = splitId(id)
  const t: Task = {
    id,
    epic,
    name,
    title: opts.title.trim(),
    status: 'todo',
    deps: dedupe(opts.deps),
    related: dedupe(opts.related),
    priority: opts.priority,
    tags: [],
    summary: opts.summary,
    done: '',
    closedInto: '',
    body: templateBody(opts.title.trim(), opts.summary),
  }
  errors.push(...refErrors(t, idx))
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: t }
}

function templateBody(title: string, summary: string): string {
  return [
    `# ${title}`,
    '',
    '## Goal',
    '',
    summary === '' ? '<What this accomplishes and why, in 1–3 sentences.>' : summary,
    '',
    '## Design',
    '',
    '<The intended approach; known vs unknown.>',
    '',
    '## How to Verify',
    '',
    '<The definition of done: runnable checks.>',
    '',
  ].join('\n')
}

/** Keep a `## Dependencies` section's links in step with a dep added or removed. No-op when the body has no such section. */
export function syncDependencySection(t: Task, added: string[], removed: string[], idx: Index): string {
  const lines = t.body.split('\n')
  const start = lines.findIndex(l => /^## Dependencies\b/.test(l))
  if (start < 0) return t.body
  let end = lines.findIndex((l, i) => i > start && /^#{1,2} /.test(l))
  if (end < 0) end = lines.length
  const dir = dirOf(taskPath(t.id))
  const section = lines.slice(start + 1, end).filter(l => {
    return !removed.some(r => l.includes(`](${relativeTo(dir, taskPath(r))}`))
  })
  let last = section.length
  while (last > 0 && section[last - 1]!.trim() === '') last--
  const kept = section.slice(0, last)
  if (added.length > 0 && kept.some(l => /^none\b/i.test(l.trim()))) {
    for (let i = kept.length - 1; i >= 0; i--) if (/^none\b/i.test(kept[i]!.trim())) kept.splice(i, 1)
  }
  const adds = added.map(d => `- [${idx.get(d)?.title ?? d}](${relativeTo(dir, taskPath(d))})`)
  while (kept.length > 0 && kept[0]!.trim() === '') kept.shift()
  const body = ['', ...kept, ...adds, ...section.slice(last)]
  if (body.length === 1 || body[body.length - 1] !== '') body.push('')
  return [...lines.slice(0, start + 1), ...body, ...lines.slice(end)].join('\n')
}

export type Move = {
  /** Every task whose content changed, keyed by its (new) id. */
  changed: Task[]
  oldPath: string
  newPath: string
}

/** Rename a task: its file, its id in every reference, and links to it from other task files. */
export function planMove(plan: Plan, oldId: string, newId: string, idx: Index): Result<Move> {
  const task = idx.get(oldId)
  const errors: string[] = []
  if (task === undefined) errors.push(`unknown task \`${oldId}\``)
  if (!isValidId(newId, plan.mode)) errors.push(`invalid id \`${newId}\``)
  if (idx.has(newId)) errors.push(`\`${newId}\` already exists`)
  if (errors.length > 0 || task === undefined) return { ok: false, errors }
  const oldPath = taskPath(oldId)
  const newPath = taskPath(newId)
  const swap = (ids: string[]): string[] => ids.map(d => (d === oldId ? newId : d))
  const changed: Task[] = []
  for (const t of plan.tasks) {
    const moving = t.id === oldId
    const oldDir = dirOf(taskPath(t.id))
    const id = moving ? newId : t.id
    const { epic, name } = splitId(id)
    const body = rewriteLinks(t.body, oldDir, dirOf(taskPath(id)), new Map([[oldPath, newPath]]))
    const next: Task = {
      ...t,
      id,
      epic,
      name,
      deps: swap(t.deps),
      related: swap(t.related),
      closedInto: t.closedInto === oldId ? newId : t.closedInto,
      body,
    }
    if (moving || body !== t.body || next.deps.join() !== t.deps.join() || next.related.join() !== t.related.join() || next.closedInto !== t.closedInto)
      changed.push(next)
  }
  return { ok: true, value: { changed, oldPath, newPath } }
}

/** Resolve a user-typed id: exact, else a unique task name or unique suffix. */
export function resolveId(input: string, ids: readonly string[]): Result<string> {
  if (ids.includes(input)) return { ok: true, value: input }
  const byName = ids.filter(id => id.endsWith(`/${input}`))
  if (byName.length === 1) return { ok: true, value: byName[0]! }
  const fuzzy = byName.length > 1 ? byName : ids.filter(id => id.includes(input))
  if (fuzzy.length === 1) return { ok: true, value: fuzzy[0]! }
  if (fuzzy.length === 0) return { ok: false, errors: [`no task matches \`${input}\``] }
  return { ok: false, errors: [`\`${input}\` is ambiguous: ${fuzzy.slice(0, 10).join(', ')}${fuzzy.length > 10 ? ', …' : ''}`] }
}
