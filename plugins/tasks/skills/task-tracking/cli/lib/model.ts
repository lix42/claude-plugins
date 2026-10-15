import { serializeFrontmatter, splitFrontmatter } from './frontmatter.ts'
import type { FmValue } from './frontmatter.ts'

export type Status = 'todo' | 'doing' | 'done' | 'closed'
export const STATUSES: readonly Status[] = ['todo', 'doing', 'done', 'closed']

export type Priority = 'low' | 'blocked'
export const PRIORITIES: readonly Priority[] = ['low', 'blocked']

export type Task = {
  /** `<name>` in flat mode, `<epic>/<name>` in epic mode. */
  id: string
  epic: string | null
  name: string
  title: string
  status: Status
  /** Hard dependencies: gate readiness. */
  deps: string[]
  /** Soft links: shown, never gate. */
  related: string[]
  priority: Priority | null
  tags: string[]
  summary: string
  /** Free-form completion note, e.g. a date and PR. */
  done: string
  /** For a closed task: the task that absorbed it. */
  closedInto: string
  /** The markdown after the frontmatter. */
  body: string
}

export type Epic = {
  name: string
  title: string
  order: number
  /** One-paragraph scope shown under the epic heading. */
  blurb: string
}

export type Mode = 'flat' | 'epic'

export type Plan = {
  mode: Mode
  /** Hand-written top of TASKS.md (`tasks/_header.md`). */
  header: string
  epics: Epic[]
  tasks: Task[]
}

export const STATUS_BOX: Record<Status, string> = { todo: ' ', doing: '~', done: 'x', closed: '-' }

/** The progress log's `**Status:**` wording. */
export const STATUS_WORD: Record<Status, string> = {
  todo: 'not started',
  doing: 'in progress',
  done: 'done',
  closed: 'closed',
}

export const ID_PART = /^[a-z0-9][a-z0-9-]*$/

export function splitId(id: string): { epic: string | null; name: string } {
  const at = id.indexOf('/')
  return at < 0 ? { epic: null, name: id } : { epic: id.slice(0, at), name: id.slice(at + 1) }
}

export function isValidId(id: string, mode: Mode): boolean {
  const { epic, name } = splitId(id)
  if (!ID_PART.test(name)) return false
  return mode === 'flat' ? epic === null : epic !== null && ID_PART.test(epic)
}

/** Task file path relative to the docs dir. */
export function taskPath(id: string): string {
  return `tasks/${id}.md`
}

export function progressPath(task: Pick<Task, 'epic'>): string {
  return task.epic === null ? 'progress.md' : `progress/${task.epic}.md`
}

const KEYS = ['title', 'status', 'deps', 'related', 'priority', 'tags', 'summary', 'done', 'closed_into'] as const
type Key = (typeof KEYS)[number]
const LIST_KEYS: ReadonlySet<Key> = new Set(['deps', 'related', 'tags'])

export type Parsed<T> = { value: T; errors: string[] }

export function parseTask(id: string, text: string): Parsed<Task> {
  const { epic, name } = splitId(id)
  const split = splitFrontmatter(text)
  const errors = [...split.errors]
  const task: Task = {
    id,
    epic,
    name,
    title: '',
    status: 'todo',
    deps: [],
    related: [],
    priority: null,
    tags: [],
    summary: '',
    done: '',
    closedInto: '',
    body: split.body,
  }
  if (split.fields === null) {
    if (errors.length === 0) errors.push('no frontmatter (run `tasks migrate`?)')
    return { value: task, errors }
  }
  const seen = new Set<string>()
  for (const [key, value] of split.fields) {
    if (seen.has(key)) errors.push(`duplicate key \`${key}\``)
    seen.add(key)
    if (!(KEYS as readonly string[]).includes(key)) {
      errors.push(`unknown key \`${key}\``)
      continue
    }
    const k = key as Key
    if (LIST_KEYS.has(k) !== Array.isArray(value)) {
      errors.push(`\`${k}\` must be ${LIST_KEYS.has(k) ? 'a list `[a, b]`' : 'a single value'}`)
      continue
    }
    applyField(task, k, value, errors)
  }
  if (!seen.has('title') || task.title === '') errors.push('missing `title`')
  if (!seen.has('status')) errors.push('missing `status`')
  return { value: task, errors }
}

function applyField(task: Task, key: Key, value: FmValue, errors: string[]): void {
  const s = typeof value === 'string' ? value : ''
  const list = Array.isArray(value) ? value : []
  switch (key) {
    case 'title':
      task.title = s
      return
    case 'status':
      if ((STATUSES as readonly string[]).includes(s)) task.status = s as Status
      else errors.push(`\`status\` must be one of ${STATUSES.join(', ')}; got \`${s}\``)
      return
    case 'priority':
      if (s === '') return
      if ((PRIORITIES as readonly string[]).includes(s)) task.priority = s as Priority
      else errors.push(`\`priority\` must be one of ${PRIORITIES.join(', ')}; got \`${s}\``)
      return
    case 'deps':
      task.deps = list
      return
    case 'related':
      task.related = list
      return
    case 'tags':
      task.tags = list
      return
    case 'summary':
      task.summary = s
      return
    case 'done':
      task.done = s
      return
    case 'closed_into':
      task.closedInto = s
      return
  }
}

/** Fields in a fixed order; empty optional fields are omitted. */
export function taskFields(t: Task): [string, FmValue][] {
  const fields: [string, FmValue][] = [
    ['title', t.title],
    ['status', t.status],
    ['deps', t.deps],
  ]
  if (t.related.length > 0) fields.push(['related', t.related])
  if (t.priority !== null) fields.push(['priority', t.priority])
  if (t.tags.length > 0) fields.push(['tags', t.tags])
  if (t.summary !== '') fields.push(['summary', t.summary])
  if (t.done !== '') fields.push(['done', t.done])
  if (t.closedInto !== '') fields.push(['closed_into', t.closedInto])
  return fields
}

export function serializeTask(t: Task): string {
  return serializeFrontmatter(taskFields(t)) + t.body
}

export function parseEpic(name: string, text: string): Parsed<Epic> {
  const split = splitFrontmatter(text)
  const errors = [...split.errors]
  const epic: Epic = { name, title: name, order: Number.MAX_SAFE_INTEGER, blurb: split.body.trim() }
  for (const [key, value] of split.fields ?? []) {
    if (key === 'title' && typeof value === 'string') epic.title = value
    else if (key === 'order' && typeof value === 'string' && /^\d+$/.test(value)) epic.order = Number(value)
    else errors.push(`unknown or malformed key \`${key}\``)
  }
  if (split.fields === null) errors.push('no frontmatter')
  return { value: epic, errors }
}

export function serializeEpic(e: Epic): string {
  const fields: [string, FmValue][] = [['title', e.title], ['order', String(e.order)]]
  return serializeFrontmatter(fields) + (e.blurb === '' ? '' : `\n${e.blurb}\n`)
}

/** Sort key for the task list: open work first, then history. */
export const STATUS_RANK: Record<Status, number> = { doing: 0, todo: 1, done: 2, closed: 3 }

export function compareTasks(a: Task, b: Task): number {
  return STATUS_RANK[a.status] - STATUS_RANK[b.status] || cmp(a.id, b.id)
}

export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
