#!/usr/bin/env node
// tasks — query and update a docs/tasks plan. Run `node tasks.ts help`.

import { readdirSync, statSync } from 'node:fs'
import { join, relative, resolve as resolvePath } from 'node:path'
import { parseArgs } from 'node:util'

import { check } from './lib/check.ts'
import type { Issue } from './lib/check.ts'
import { dependentsOf, indexTasks, ready, transitiveDeps, unblockedBy, unsettledDeps } from './lib/graph.ts'
import type { Index } from './lib/graph.ts'
import { exists, findDocs, gitDirty, makeDir, remove, gitGrep, gitTopLevel, isProblem, loadPlan, move, read, readIfExists, scanLayout, today, write } from './lib/io.ts'
import type { Loaded } from './lib/io.ts'
import { rewriteLinks, dirOf } from './lib/links.ts'
import { migrate } from './lib/migrate.ts'
import { parseGroupMap, planGroup } from './lib/group.ts'
import { cmp, parseTask, PRIORITIES, progressPath, serializeEpic, serializeTask, STATUS_WORD, STATUSES, taskPath } from './lib/model.ts'
import type { Epic, Plan, Priority, Status, Task } from './lib/model.ts'
import { applySet, newTask, planMove, resolveId, syncDependencySection } from './lib/ops.ts'
import { appendBlock, appendEntry, ensureSection, findSection, epicLogHeader, setStatusMirror, takeSection, renameSection } from './lib/progress.ts'
import { renderIndex } from './lib/render.ts'

const HELP = `tasks — a dependency-aware task plan kept as markdown files under docs/

Usage: tasks <command> [args] [--root <docs-dir>] [--json]

Query
  ready [--epic E]              tasks whose deps are all done, ranked by leverage
  show <id>                     one task: fields, deps with status, dependents, paths
  list [--epic E] [--status S[,S]] [--tag T] [--open]
  deps <id> [--all]             what <id> waits on (--all: transitively)
  unblocks <id>                 dependents, and which would become ready once <id> is done

Update (each re-renders TASKS.md)
  set <id> key=value ...        title, status, priority (low|blocked|none), summary, done,
                                closed_into; lists deps/related/tags take =, += and -=
  new <id> --title T [--deps a,b] [--related a,b] [--summary S] [--priority P]
  mv <old-id> <new-id>          rename or move between epics (a new epic is created): file, refs,
                                links, progress section
  group <map.json> [--dry-run]  promote a flat plan to epics; map: {"epics": [{"name", "blurb"?,
                                "tasks": [names]}]} in display order
  log <id> [text|-]             append a dated entry to the task's progress section (- or no
                                text reads stdin); --status also sets the task's status
  render                        regenerate TASKS.md
  init [--epics] [--title T]    start a plan in an empty docs dir
  migrate [--dry-run]           convert a pre-frontmatter plan (status and edges in TASKS.md)

Check
  check [--strict]              exit 1 on errors (and on warnings with --strict)

Ids: <name> in a flat plan, <epic>/<name> with epics. A unique name or substring is accepted.
Statuses: ${STATUSES.join(', ')}.  Dates use --date YYYY-MM-DD when given, else today.`

type Opts = {
  root?: string
  json?: boolean
  epic?: string
  epics?: boolean
  status?: string
  tag?: string
  open?: boolean
  all?: boolean
  title?: string
  deps?: string
  related?: string
  summary?: string
  priority?: string
  strict?: boolean
  'dry-run'?: boolean
  date?: string
  help?: boolean
}

class Exit extends Error {
  code: number
  constructor(code: number, message: string) {
    super(message)
    this.code = code
  }
}

const fail = (msg: string, code = 2): never => {
  throw new Exit(code, msg)
}

function main(argv: string[]): number {
  let parsed: ReturnType<typeof parseArgs>
  try {
    parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      root: { type: 'string' },
      json: { type: 'boolean' },
      epic: { type: 'string' },
      epics: { type: 'boolean' },
      status: { type: 'string' },
      tag: { type: 'string' },
      open: { type: 'boolean' },
      all: { type: 'boolean' },
      title: { type: 'string' },
      deps: { type: 'string' },
      related: { type: 'string' },
      summary: { type: 'string' },
      priority: { type: 'string' },
      strict: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      date: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  } catch (e) {
    return fail(`${(e as Error).message} (put text that starts with "-" after \`--\`)`)
  }
  const { values, positionals } = parsed
  const opts = values as Opts
  const [cmd, ...args] = positionals
  if (cmd === undefined || cmd === 'help' || opts.help) {
    print(HELP)
    return 0
  }
  if (opts.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) fail('--date must be YYYY-MM-DD')
  const date = opts.date ?? today()
  if (cmd === 'init') {
    const top = gitTopLevel(process.cwd()) ?? process.cwd()
    return cmdInit({ docs: opts.root === undefined ? join(top, 'docs') : resolvePath(process.cwd(), opts.root), opts, date })
  }
  const docs = findDocs(process.cwd(), opts.root) ?? fail('no plan found: no docs/TASKS.md or docs/tasks/ up to the git root (use --root, or `tasks init`)')
  const ctx: Ctx = { docs, opts, date }
  if (cmd === 'migrate') return cmdMigrate(ctx)
  const loaded = load(docs)
  // A write re-serializes from the parse, which drops whatever it rejected; refuse rather than lose it.
  const writes = ['set', 'new', 'mv', 'log', 'group'].includes(cmd)
  const blocking = loaded.problems.filter(p => !p.message.startsWith('missing epic file'))
  if (writes && blocking.length > 0)
    fail(`fix these first (\`tasks check\` lists them); writing now would drop what they reject:\n${blocking.map(p => `  ${p.path}: ${p.message}`).join('\n')}`, 1)
  const c: LoadedCtx = { ...ctx, ...loaded, idx: indexTasks(loaded.plan) }
  switch (cmd) {
    case 'ready':
    case 'next':
      return cmdReady(c)
    case 'show':
      return cmdShow(c, one(args, 'show <id>'))
    case 'list':
      return cmdList(c)
    case 'deps':
      return cmdDeps(c, one(args, 'deps <id>'))
    case 'unblocks':
      return cmdUnblocks(c, one(args, 'unblocks <id>'))
    case 'set':
      return cmdSet(c, args)
    case 'new':
      return cmdNew(c, one(args, 'new <id> --title T'))
    case 'mv':
      return cmdMv(c, args)
    case 'group':
      return cmdGroup(c, one(args, 'group <map.json>'))
    case 'log':
      return cmdLog(c, args)
    case 'render':
      return cmdRender(c)
    case 'check':
      return cmdCheck(c)
    default:
      return fail(`unknown command \`${cmd}\`; run \`tasks help\``)
  }
}

type Ctx = { docs: string; opts: Opts; date: string }
type LoadedCtx = Ctx & Loaded & { idx: Index }

function load(docs: string): Loaded {
  const loaded = loadPlan(docs)
  if (isProblem(loaded)) return fail(`${loaded.path}: ${loaded.message}`)
  const legacy = loaded.plan.tasks.length > 0 && loaded.problems.filter(p => p.message.startsWith('no frontmatter')).length === loaded.plan.tasks.length
  if (legacy) fail('this plan predates frontmatter task files; run `tasks migrate --dry-run`, then `tasks migrate`')
  return loaded
}

function one(args: string[], usage: string): string {
  if (args.length !== 1) fail(`usage: tasks ${usage}`)
  return args[0]!
}

function resolve(c: LoadedCtx, input: string): Task {
  const r = resolveId(input, c.plan.tasks.map(t => t.id))
  if (!r.ok) return fail(r.errors.join('\n'))
  return c.idx.get(r.value)!
}

function print(s: string): void {
  process.stdout.write(s.endsWith('\n') ? s : s + '\n')
}

function printJson(v: unknown): void {
  print(JSON.stringify(v, null, 2))
}

function taskJson(t: Task, c: LoadedCtx): Record<string, unknown> {
  return {
    id: t.id,
    epic: t.epic,
    title: t.title,
    status: t.status,
    deps: t.deps,
    related: t.related,
    priority: t.priority,
    tags: t.tags,
    summary: t.summary,
    done: t.done,
    closed_into: t.closedInto,
    waits_on: unsettledDeps(t, c.idx),
    path: join(relative(process.cwd(), c.docs) || '.', taskPath(t.id)),
    progress: join(relative(process.cwd(), c.docs) || '.', progressPath(t)),
  }
}

function label(t: Task | undefined, id: string): string {
  return t === undefined ? `${id} (missing)` : `${id} [${t.status}] — ${t.title}`
}

// ---- queries ---------------------------------------------------------------

function cmdReady(c: LoadedCtx): number {
  const report = ready(c.plan, c.idx)
  const scope = c.opts.epic ?? null
  const inScope = (id: string): boolean => scope === null || id.startsWith(`${scope}/`)
  const items = report.ready.filter(r => inScope(r.id))
  const elsewhere = report.ready.length - items.length
  if (c.opts.json) {
    printJson({ ready: items, doing: report.doing.filter(inScope), held: report.held.filter(inScope), ready_elsewhere: elsewhere })
    return 0
  }
  const out: string[] = []
  if (items.length === 0) out.push(scope ? `Nothing ready in ${scope}.` : 'Nothing ready.')
  else out.push(`Ready (${items.length}), highest leverage first:`)
  for (const r of items) {
    const facts = [`downstream ${r.downstream}`, `chain ${r.chain}`]
    if (r.unblocks.length > 0) facts.push(`unblocks ${r.unblocks.join(', ')}`)
    if (r.priority === 'low') facts.push('low priority')
    out.push(`  ${r.id} — ${r.title}`, `      ${facts.join(' · ')}`)
  }
  const doing = report.doing.filter(inScope)
  if (doing.length > 0) out.push(`In progress: ${doing.join(', ')}`)
  const held = report.held.filter(inScope)
  if (held.length > 0) out.push(`Held (priority: blocked): ${held.join(', ')}`)
  if (scope && elsewhere > 0) out.push(`(${elsewhere} ready in other epics)`)
  if (items.length === 0 && doing.length === 0) {
    const open = c.plan.tasks.filter(t => t.status === 'todo' && inScope(t.id))
    for (const t of open.slice(0, 10)) out.push(`  blocked: ${t.id} waits on ${unsettledDeps(t, c.idx).join(', ') || '(priority: blocked)'}`)
  }
  print(out.join('\n'))
  return 0
}

function cmdShow(c: LoadedCtx, input: string): number {
  const t = resolve(c, input)
  const dependents = dependentsOf(c.plan).get(t.id) ?? []
  if (c.opts.json) {
    printJson({ ...taskJson(t, c), dependents, unblocks: unblockedBy(t.id, c.plan, c.idx) })
    return 0
  }
  const j = taskJson(t, c)
  const out = [`${t.id} [${t.status}] — ${t.title}`]
  if (t.summary) out.push(`  ${t.summary}`)
  if (t.priority) out.push(`  priority: ${t.priority}`)
  if (t.tags.length > 0) out.push(`  tags: ${t.tags.join(', ')}`)
  if (t.done) out.push(`  done: ${t.done}`)
  if (t.closedInto) out.push(`  closed into: ${t.closedInto}`)
  out.push(`  file: ${j.path}`, `  progress: ${j.progress} (## ${t.name})`)
  out.push(`deps (${t.deps.length}):`, ...t.deps.map(d => `  ${label(c.idx.get(d), d)}`))
  if (t.related.length > 0) out.push(`related:`, ...t.related.map(d => `  ${label(c.idx.get(d), d)}`))
  out.push(`dependents (${dependents.length}):`, ...dependents.map(d => `  ${label(c.idx.get(d), d)}`))
  print(out.join('\n'))
  return 0
}

function cmdList(c: LoadedCtx): number {
  const statuses = c.opts.status?.split(',').map(s => s.trim())
  for (const s of statuses ?? []) if (!(STATUSES as readonly string[]).includes(s)) fail(`unknown status \`${s}\``)
  const epic = c.opts.epic ?? null
  const tasks = c.plan.tasks
    .filter(t => epic === null || t.epic === epic)
    .filter(t => !statuses || statuses.includes(t.status))
    .filter(t => !c.opts.open || t.status === 'todo' || t.status === 'doing')
    .filter(t => !c.opts.tag || t.tags.includes(c.opts.tag))
    .sort((a, b) => cmp(a.id, b.id))
  if (c.opts.json) printJson(tasks.map(t => taskJson(t, c)))
  else print(tasks.length === 0 ? 'No matching tasks.' : tasks.map(t => label(t, t.id)).join('\n'))
  return 0
}

function cmdDeps(c: LoadedCtx, input: string): number {
  const t = resolve(c, input)
  const ids = c.opts.all ? transitiveDeps(t.id, c.idx) : t.deps
  if (c.opts.json) printJson(ids.map(id => ({ id, status: c.idx.get(id)?.status ?? null, title: c.idx.get(id)?.title ?? null })))
  else print(ids.length === 0 ? `${t.id} has no dependencies.` : ids.map(id => label(c.idx.get(id), id)).join('\n'))
  return 0
}

function cmdUnblocks(c: LoadedCtx, input: string): number {
  const t = resolve(c, input)
  const dependents = dependentsOf(c.plan).get(t.id) ?? []
  const freed = unblockedBy(t.id, c.plan, c.idx)
  if (c.opts.json) {
    printJson({ dependents, would_become_ready: freed })
    return 0
  }
  const out = [`Dependents of ${t.id} (${dependents.length}):`, ...dependents.map(d => `  ${label(c.idx.get(d), d)}`)]
  out.push(freed.length > 0 ? `Would become ready once it is done: ${freed.join(', ')}` : 'Nothing becomes ready from this task alone.')
  print(out.join('\n'))
  return 0
}

// ---- updates ---------------------------------------------------------------

function writeTask(c: Ctx, t: Task): void {
  write(join(c.docs, taskPath(t.id)), serializeTask(t))
}

/** Re-render TASKS.md from the plan after an update. */
function rerender(c: Ctx, plan: Plan): void {
  write(join(c.docs, 'TASKS.md'), renderIndex(plan, indexTasks(plan)))
}

function withTask(plan: Plan, t: Task): Plan {
  return { ...plan, tasks: plan.tasks.map(x => (x.id === t.id ? t : x)) }
}

function cmdSet(c: LoadedCtx, args: string[]): number {
  if (args.length < 2) fail('usage: tasks set <id> key=value ...')
  const before = resolve(c, args[0]!)
  const r = applySet(before, args.slice(1).map(a => resolveRefs(c, a)), c.idx)
  if (!r.ok) return fail(r.errors.join('\n'))
  let t = r.value
  const added = t.deps.filter(d => !before.deps.includes(d))
  const removed = before.deps.filter(d => !t.deps.includes(d))
  if (added.length > 0 || removed.length > 0) t = { ...t, body: syncDependencySection(t, added, removed, c.idx) }
  const plan = withTask(c.plan, t)
  writeTask(c, t)
  if (t.status !== before.status) mirrorStatus(c, t)
  rerender(c, plan)
  const idx = indexTasks(plan)
  const finished = t.status !== before.status && (t.status === 'done' || t.status === 'closed')
  const nowReady = finished ? ready(plan, idx).ready.map(x => x.id).filter(id => idx.get(id)!.deps.includes(t.id)) : []
  if (c.opts.json) printJson({ task: taskJson(t, { ...c, plan, idx }), now_ready: nowReady })
  else {
    print(`Updated ${t.id}.`)
    if (finished) print(nowReady.length > 0 ? `Now ready: ${nowReady.join(', ')}` : 'No task became ready.')
  }
  return 0
}

/** Expand short task names in `deps`/`related`/`closed_into` values; unknown names pass through to be reported. */
function resolveRefs(c: LoadedCtx, assignment: string): string {
  const m = /^(deps|related|closed_into)(\+=|-=|=)(.*)$/s.exec(assignment)
  if (!m) return assignment
  const ids = c.plan.tasks.map(t => t.id)
  const vals = m[3]!.split(',').map(v => v.trim()).filter(v => v !== '').map(v => {
    const r = resolveId(v, ids)
    return r.ok ? r.value : v
  })
  return `${m[1]}${m[2]}${vals.join(',')}`
}

function mirrorStatus(c: Ctx, t: Task): void {
  const path = join(c.docs, progressPath(t))
  const text = readIfExists(path)
  if (text === null) return
  const next = setStatusMirror(text, t.name, STATUS_WORD[t.status], c.date)
  if (next !== null && next !== text) write(path, next)
}

function list(s: string | undefined): string[] {
  return (s ?? '').split(',').map(x => x.trim()).filter(x => x !== '')
}

function cmdNew(c: LoadedCtx, id: string): number {
  const priority = c.opts.priority ?? null
  if (priority !== null && !(PRIORITIES as readonly string[]).includes(priority)) fail(`--priority must be one of ${PRIORITIES.join(', ')}`)
  const resolveAll = (ids: string[]): string[] => ids.map(d => resolve(c, d).id)
  const r = newTask(
    id,
    c.plan.mode,
    {
      title: c.opts.title ?? '',
      summary: c.opts.summary ?? '',
      deps: resolveAll(list(c.opts.deps)),
      related: resolveAll(list(c.opts.related)),
      priority: priority as Priority | null,
    },
    c.idx,
  )
  if (!r.ok) return fail(r.errors.join('\n'))
  const t = r.value
  let plan: Plan = { ...c.plan, tasks: [...c.plan.tasks, t] }
  if (t.epic !== null && !c.plan.epics.some(e => e.name === t.epic)) plan = { ...plan, epics: [...plan.epics, createEpic(c, plan, t.epic)] }
  writeTask(c, t)
  const pp = join(c.docs, progressPath(t))
  const existing = readIfExists(pp) ?? (t.epic === null ? '' : epicLogHeader(projectName(c), t.epic))
  write(pp, ensureSection(existing, t.name, STATUS_WORD.todo, c.date, t.summary))
  rerender(c, plan)
  if (c.opts.json) printJson(taskJson(t, { ...c, plan, idx: indexTasks(plan) }))
  else print(`Created ${taskPath(t.id)}; fill in its Goal, Design and How to Verify.`)
  return 0
}

/** Write a new epic's `_epic.md`, ordered last; its progress file is created on first use. */
function createEpic(c: Ctx, plan: Plan, name: string): Epic {
  const order = Math.max(0, ...plan.epics.map(e => e.order).filter(o => o < Number.MAX_SAFE_INTEGER)) + 1
  const epic: Epic = { name, title: name, order, blurb: '' }
  write(join(c.docs, `tasks/${name}/_epic.md`), serializeEpic(epic))
  return epic
}

function projectName(c: Ctx): string {
  const header = readIfExists(join(c.docs, 'tasks/_header.md')) ?? ''
  return /^# (.+?)(?:\s+[—–-]\s+(?:Project\s+)?Tasks)?\s*$/im.exec(header)?.[1] ?? 'Project'
}

function cmdMv(c: LoadedCtx, args: string[]): number {
  if (args.length !== 2) fail('usage: tasks mv <old-id> <new-id>')
  const old = resolve(c, args[0]!)
  const newId = args[1]!
  const r = planMove(c.plan, old.id, newId, c.idx)
  if (!r.ok) return fail(r.errors.join('\n'))
  const { changed, oldPath, newPath } = r.value
  const moved = changed.find(t => t.id === newId)!
  let plan: Plan = { ...c.plan, tasks: c.plan.tasks.filter(t => t.id !== old.id) }
  for (const t of changed) plan = t.id === newId ? { ...plan, tasks: [...plan.tasks, t] } : withTask(plan, t)
  const destLog = readIfExists(join(c.docs, progressPath(moved)))
  const sameLog = progressPath(moved) === progressPath(old)
  if (destLog !== null && (!sameLog || moved.name !== old.name) && findSection(destLog.split('\n'), moved.name) !== null)
    fail(`${progressPath(moved)} already has a \`## ${moved.name}\` section; resolve it first`)

  if (moved.epic !== null && !plan.epics.some(e => e.name === moved.epic)) plan = { ...plan, epics: [...plan.epics, createEpic(c, plan, moved.epic)] }

  move(join(c.docs, oldPath), join(c.docs, newPath))
  for (const t of changed) writeTask(c, t)
  const progress = moveProgress(c, old, moved)
  const relinked = relinkDocs(c, new Map([[oldPath, newPath]]))
  rerender(c, plan)

  const top = gitTopLevel(c.docs) ?? c.docs
  const docsRel = relative(top, c.docs)
  const mentions = [
    ...gitGrep(top, `\`${old.id}\``).filter(l => !l.includes('TASKS.md:')),
    ...gitGrep(top, oldPath).filter(l => !l.startsWith(`${docsRel}/`)),
  ]
  if (c.opts.json) printJson({ from: old.id, to: newId, updated_tasks: changed.map(t => t.id), relinked_docs: relinked, progress, prose_mentions: mentions })
  else {
    const out = [`Moved ${old.id} → ${newId}; updated ${changed.length} task file(s), ${relinked.length} other doc(s). Progress: ${progress}.`]
    if (mentions.length > 0) out.push(`Backticked mentions of \`${old.id}\` left for you to review (not rewritten):`, ...mentions.slice(0, 40).map(m => `  ${m}`))
    print(out.join('\n'))
  }
  return 0
}

function moveProgress(c: Ctx, old: Task, moved: Task): string {
  const from = join(c.docs, progressPath(old))
  const to = join(c.docs, progressPath(moved))
  const text = readIfExists(from)
  if (text === null) return 'no progress file'
  if (from === to) {
    const next = renameSection(text, old.name, moved.name)
    if (next === null) return 'no section to rename'
    write(from, next)
    return 'heading renamed'
  }
  const taken = takeSection(text, old.name, moved.name)
  if (taken === null) return 'no section to move'
  const dest = readIfExists(to) ?? epicLogHeader(projectName(c), moved.epic ?? '')
  write(to, appendBlock(dest.replace(/\n$/, '').split('\n'), taken.section).join('\n') + '\n')
  write(from, taken.rest)
  return `section moved to ${progressPath(moved)}`
}

/** Fix links to the moved file in every other markdown file under docs/ (task files are already done). */
function relinkDocs(c: Ctx, moves: ReadonlyMap<string, string>): string[] {
  const out: string[] = []
  for (const rel of markdownFiles(c.docs)) {
    const isTask = rel.startsWith('tasks/') && !/(^|\/)_[^/]*\.md$/.test(rel)
    if (isTask || rel === 'TASKS.md') continue
    const text = read(join(c.docs, rel))
    const next = rewriteLinks(text, dirOf(rel), dirOf(rel), moves)
    if (next !== text) {
      write(join(c.docs, rel), next)
      out.push(rel)
    }
  }
  return out
}

function markdownFiles(root: string, sub = ''): string[] {
  const out: string[] = []
  for (const e of readdirSync(join(root, sub)).sort(cmp)) {
    const rel = sub === '' ? e : `${sub}/${e}`
    if (statSync(join(root, rel)).isDirectory()) out.push(...markdownFiles(root, rel))
    else if (e.endsWith('.md')) out.push(rel)
  }
  return out
}

function cmdGroup(c: LoadedCtx, mapPath: string): number {
  const parsed = parseGroupMap(read(resolvePath(process.cwd(), mapPath)))
  if (!parsed.ok) return fail(parsed.errors.join('\n'))
  const progressFile = join(c.docs, 'progress.md')
  const r = planGroup(c.plan, parsed.value, readIfExists(progressFile), projectName(c), c.date)
  if (!r.ok) return fail(r.errors.join('\n'))
  const { plan, moves, logs, unassigned } = r.value
  const dry = c.opts['dry-run'] === true
  if (!dry) {
    const dirty = gitDirty(c.docs)
    if (dirty !== null && dirty.length > 0) fail(`commit or stash the changes under ${c.docs} first; group rewrites every task file:\n${dirty.slice(0, 10).join('\n')}`)
    for (const t of c.plan.tasks) remove(join(c.docs, taskPath(t.id)))
    for (const t of plan.tasks) writeTask(c, t)
    for (const e of plan.epics) write(join(c.docs, `tasks/${e.name}/_epic.md`), serializeEpic(e))
    for (const [path, text] of logs) write(join(c.docs, path), text)
    if (exists(progressFile)) remove(progressFile)
    relinkDocs(c, moves)
    rerender(c, plan)
  }
  const top = gitTopLevel(c.docs)
  const docsRel = top === null ? '' : relative(top, c.docs)
  const outside = top === null ? [] : [...moves.keys()].flatMap(p => gitGrep(top, p).filter(l => !l.startsWith(`${docsRel}/`)))
  const summary = {
    epics: plan.epics.map(e => ({ name: e.name, tasks: plan.tasks.filter(t => t.epic === e.name).length })),
    unassigned_sections: unassigned,
    outside_mentions: outside,
  }
  if (c.opts.json) printJson({ dry_run: dry, ...summary })
  else {
    const out = [`${dry ? 'Would group' : 'Grouped'} ${plan.tasks.length} tasks into ${plan.epics.length} epics:`, ...summary.epics.map(e => `  ${e.name}: ${e.tasks}`)]
    if (unassigned.length > 0) out.push(`Progress sections naming no task, parked in progress/_unassigned.md: ${unassigned.join('; ')}`)
    if (outside.length > 0) out.push('Old task paths mentioned outside docs/ (not rewritten; review):', ...outside.slice(0, 40).map(l => `  ${l}`))
    if (!dry) out.push('Next: rewrite the progress-log note in tasks/_header.md for epic mode, fill each Epic summary, run `tasks check`, review the diff.')
    print(out.join('\n'))
  }
  return 0
}

function cmdLog(c: LoadedCtx, args: string[]): number {
  if (args.length < 1) fail('usage: tasks log <id> [text|-]')
  let t = resolve(c, args[0]!)
  const raw = args.length === 1 || args[1] === '-' ? readStdin() : args.slice(1).join(' ')
  if (raw.trim() === '') fail('empty log entry')
  const status = c.opts.status
  if (status !== undefined) {
    if (!(STATUSES as readonly string[]).includes(status)) fail(`unknown status \`${status}\``)
    if (status !== t.status) {
      t = { ...t, status: status as Status }
      writeTask(c, t)
      rerender(c, withTask(c.plan, t))
    }
  }
  const path = join(c.docs, progressPath(t))
  const existing = readIfExists(path) ?? (t.epic === null ? '' : epicLogHeader(projectName(c), t.epic))
  let next = appendEntry(existing, t.name, c.date, raw, STATUS_WORD[t.status])
  next = setStatusMirror(next, t.name, STATUS_WORD[t.status], c.date) ?? next
  write(path, next)
  if (c.opts.json) printJson({ id: t.id, progress: progressPath(t), date: c.date, status: t.status })
  else print(`Logged to ${progressPath(t)} ## ${t.name}.`)
  return 0
}

function readStdin(): string {
  try {
    return read('/dev/stdin')
  } catch {
    return ''
  }
}

function cmdRender(c: LoadedCtx): number {
  const errors = c.problems.filter(p => !p.message.startsWith('missing epic file'))
  if (errors.length > 0) fail(`fix these first:\n${errors.map(p => `  ${p.path}: ${p.message}`).join('\n')}`, 1)
  rerender(c, c.plan)
  if (!c.opts.json) print('Rendered TASKS.md.')
  return 0
}

function cmdCheck(c: LoadedCtx): number {
  const progress = new Map<string, string | null>()
  for (const t of c.plan.tasks) {
    const p = progressPath(t)
    if (!progress.has(p)) progress.set(p, readIfExists(join(c.docs, p)))
  }
  const issues = check({ plan: c.plan, idx: c.idx, problems: c.problems, indexText: readIfExists(join(c.docs, 'TASKS.md')), progress })
  const errors = issues.filter(i => i.level === 'error')
  const warnings = issues.filter(i => i.level === 'warning')
  if (c.opts.json) printJson({ errors, warnings })
  else {
    const fmt = (i: Issue): string => `  ${i.path}: ${i.message}`
    const out: string[] = []
    if (errors.length > 0) out.push(`${errors.length} error(s):`, ...errors.map(fmt))
    if (warnings.length > 0) out.push(`${warnings.length} warning(s):`, ...warnings.map(fmt))
    out.push(issues.length === 0 ? `OK: ${c.plan.tasks.length} tasks.` : `${c.plan.tasks.length} tasks checked.`)
    print(out.join('\n'))
  }
  return errors.length > 0 || (c.opts.strict && warnings.length > 0) ? 1 : 0
}

// ---- setup -----------------------------------------------------------------

function cmdInit(c: Ctx): number {
  if (exists(join(c.docs, 'tasks')) || exists(join(c.docs, 'TASKS.md'))) fail('a plan already exists here')
  const epic = c.opts.epics === true
  const title = c.opts.title ?? 'Project'
  const progressNote = epic
    ? '> **Progress log:** one file per epic under [progress/](progress/) records *how* each task is carried\n> out. Before starting a task, read your epic\'s progress file in full, plus the `Epic summary` of\n> every epic it depends on; log as you work with `tasks log <id> "…"`.'
    : '> **Progress log:** [progress.md](progress.md) records *how* each task is carried out. Read it before\n> starting a task; log as you work with `tasks log <id> "…"`.'
  write(join(c.docs, 'tasks/_header.md'), `# ${title} — Tasks\n\n${progressNote}\n`)
  if (epic) makeDir(join(c.docs, 'progress'))
  if (!epic)
    write(
      join(c.docs, 'progress.md'),
      `# ${title} — Progress Log\n\nHow each task is actually being carried out. One \`##\` section per task; append entries, don't rewrite them.\n`,
    )
  const plan: Plan = { mode: epic ? 'epic' : 'flat', header: read(join(c.docs, 'tasks/_header.md')), epics: [], tasks: [] }
  rerender(c, plan)
  print(`Initialised a ${plan.mode} plan in ${relative(process.cwd(), c.docs) || '.'}; add tasks with \`tasks new\`.`)
  return 0
}

function cmdMigrate(c: Ctx): number {
  const layout = scanLayout(c.docs)
  if (isProblem(layout)) return fail(`${layout.path}: ${layout.message}`)
  const tasksMd = readIfExists(join(c.docs, 'TASKS.md')) ?? fail('no TASKS.md to migrate from')
  if (tasksMd.startsWith('<!-- Generated by the tasks CLI')) fail('TASKS.md is already generated; nothing to migrate')
  const files = layout.ids.map(id => ({ id, text: read(join(c.docs, taskPath(id))) }))
  const result = migrate({ mode: layout.mode, tasksMd, files, epicDirs: layout.epicDirs, today: c.date })
  const { plan, report } = result

  const unsafe = plan.tasks.flatMap(t => parseTask(t.id, serializeTask(t)).errors.map(e => `  ${taskPath(t.id)}: ${e}`))
  if (unsafe.length > 0) fail(`would not round-trip; nothing written:\n${unsafe.join('\n')}`, 1)
  if (!c.opts['dry-run']) {
    if (plan.mode === 'epic') {
      for (const id of new Set(plan.tasks.map(t => t.epic!).filter(e => !layout.epicDirs.includes(e))))
        fail(`task in unknown epic directory \`${id}\``)
    }
    for (const t of plan.tasks) writeTask(c, t)
    for (const e of plan.epics) write(join(c.docs, `tasks/${e.name}/_epic.md`), serializeEpic(e))
    write(join(c.docs, 'tasks/_header.md'), plan.header.trim() + '\n')
    const reloaded = loadPlan(c.docs)
    if (isProblem(reloaded)) return fail(`${reloaded.path}: ${reloaded.message}`, 1)
    const bad = reloaded.problems.filter(p => !report.alreadyMigrated.some(id => p.path === taskPath(id)))
    if (bad.length > 0) fail(`round-trip failed:\n${bad.map(p => `  ${p.path}: ${p.message}`).join('\n')}`, 1)
    rerender(c, reloaded.plan)
  }
  if (c.opts.json) printJson(report)
  else print(formatReport(report, c.opts['dry-run'] === true))
  return 0
}

function formatReport(r: ReturnType<typeof migrate>['report'], dry: boolean): string {
  const out = [
    `${dry ? 'Dry run' : 'Migrated'}: ${r.total} tasks (${r.mode} mode) — ${STATUSES.map(s => `${r.counts[s]} ${s}`).join(', ')}.`,
    `Deps taken from: TASKS.md list ${r.depsSource.list}, "Depends" prose ${r.depsSource.clause}, task-file links ${r.depsSource.file}, none ${r.depsSource.none}.`,
    `${r.notes} task(s) got a migration note with list text that did not fit a field.`,
  ]
  const section = (title: string, rows: string[]): void => {
    if (rows.length > 0) out.push('', `${title} (${rows.length}):`, ...rows.map(x => `  ${x}`))
  }
  section('Stub files created for listed tasks without one', r.stubs)
  section('Files TASKS.md does not list — migrated as closed; review', r.unlisted)
  section('Already had frontmatter — left alone', r.alreadyMigrated)
  section('Listed twice — first kept', r.duplicates)
  section('Unparsed list-like lines', r.unparsed.map(u => `TASKS.md:${u.line}: ${u.text}`))
  section('"Depends: none" clauses (ids not kept as deps)', r.noneClauses.map(n => `${n.id}: ${n.text}`))
  section(
    'Kept deps disagree with the file\'s ## Dependencies links (TASKS.md wins; fix the prose)',
    r.disagreements.map(d => `${d.id}: kept [${d.kept.join(', ')}], file [${d.file.join(', ')}]`),
  )
  section('Epic directories without a TASKS.md heading', r.epicsWithoutHeading)
  if (dry) out.push('', 'Nothing written. Run `tasks migrate` to apply, then `tasks check`.')
  else out.push('', 'Next: review tasks/_header.md, run `tasks check`, and commit.')
  return out.join('\n')
}

try {
  process.exitCode = main(process.argv.slice(2))
} catch (e) {
  if (e instanceof Exit) {
    process.stderr.write(`tasks: ${e.message}\n`)
    process.exitCode = e.code
  } else {
    throw e
  }
}
