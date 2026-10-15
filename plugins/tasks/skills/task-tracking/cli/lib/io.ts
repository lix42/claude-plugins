// The only module that touches the filesystem or spawns processes.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { cmp, parseEpic, parseTask } from './model.ts'
import type { Epic, Mode, Plan, Task } from './model.ts'

export type Problem = { path: string; message: string }

export type Layout = {
  docs: string
  mode: Mode
  /** Task file ids found on disk. */
  ids: string[]
  epicDirs: string[]
}

export function read(path: string): string {
  return readFileSync(path, 'utf8')
}

export function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

export function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

export function remove(path: string): void {
  rmSync(path, { force: true })
}

/** Uncommitted changes under `dir`, or null when it is not in a git repo. */
export function gitDirty(dir: string): string[] | null {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--', '.'], { cwd: dir, encoding: 'utf8' })
    return out.split('\n').filter(l => l !== '')
  } catch {
    return null
  }
}

export function makeDir(path: string): void {
  mkdirSync(path, { recursive: true })
}

export function exists(path: string): boolean {
  return existsSync(path)
}

export function move(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true })
  renameSync(from, to)
}

/** The docs dir: `--root`, else `docs/` in the nearest ancestor that has a plan, stopping at the git root. */
export function findDocs(cwd: string, explicit: string | undefined): string | null {
  if (explicit !== undefined) return resolve(cwd, explicit)
  let dir = resolve(cwd)
  for (;;) {
    const docs = join(dir, 'docs')
    if (existsSync(join(docs, 'TASKS.md')) || isDir(join(docs, 'tasks'))) return docs
    if (existsSync(join(dir, '.git'))) return null
    const up = dirname(dir)
    if (up === dir) return null
    dir = up
  }
}

function isDir(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory()
}

const isTaskFile = (f: string): boolean => f.endsWith('.md') && !f.startsWith('_')

export function scanLayout(docs: string): Layout | Problem {
  const tasksDir = join(docs, 'tasks')
  if (!isDir(tasksDir)) return { path: tasksDir, message: 'no tasks/ directory: there is no plan here (run `tasks init`)' }
  const entries = readdirSync(tasksDir).sort(cmp)
  const dirs = entries.filter(e => isDir(join(tasksDir, e)))
  const flatFiles = entries.filter(isTaskFile)
  if (dirs.length > 0 && flatFiles.length > 0)
    return {
      path: tasksDir,
      message: `mixed layout: both task files (${flatFiles[0]}) and epic directories (${dirs[0]}) under tasks/`,
    }
  // An empty plan has no task paths to go by; a progress/ directory marks epic mode.
  if (dirs.length === 0 && flatFiles.length === 0 && isDir(join(docs, 'progress')))
    return { docs, mode: 'epic', ids: [], epicDirs: [] }
  if (dirs.length === 0) return { docs, mode: 'flat', ids: flatFiles.map(f => f.slice(0, -3)), epicDirs: [] }
  const ids = dirs.flatMap(d =>
    readdirSync(join(tasksDir, d)).filter(isTaskFile).sort(cmp).map(f => `${d}/${f.slice(0, -3)}`),
  )
  return { docs, mode: 'epic', ids, epicDirs: dirs }
}

export function isProblem(x: unknown): x is Problem {
  return typeof x === 'object' && x !== null && 'message' in x && 'path' in x
}

export type Loaded = { plan: Plan; problems: Problem[]; layout: Layout }

export function loadPlan(docs: string): Loaded | Problem {
  const layout = scanLayout(docs)
  if (isProblem(layout)) return layout
  const problems: Problem[] = []
  const tasks: Task[] = []
  for (const id of layout.ids) {
    const path = `tasks/${id}.md`
    const { value, errors } = parseTask(id, read(join(docs, path)))
    tasks.push(value)
    for (const message of errors) problems.push({ path, message })
  }
  const epics: Epic[] = []
  for (const dir of layout.epicDirs) {
    const path = `tasks/${dir}/_epic.md`
    const text = readIfExists(join(docs, path))
    if (text === null) {
      problems.push({ path, message: 'missing epic file (title, order, blurb)' })
      epics.push({ name: dir, title: dir, order: Number.MAX_SAFE_INTEGER, blurb: '' })
      continue
    }
    const { value, errors } = parseEpic(dir, text)
    epics.push(value)
    for (const message of errors) problems.push({ path, message })
  }
  const header = readIfExists(join(docs, 'tasks/_header.md')) ?? ''
  return { plan: { mode: layout.mode, header, epics, tasks }, problems, layout }
}

/** `git grep` for a fixed string from the repo containing `dir`; empty when not in git. */
export function gitGrep(dir: string, needle: string): string[] {
  try {
    const out = execFileSync('git', ['grep', '-n', '-F', '--', needle], { cwd: dir, encoding: 'utf8' })
    return out.split('\n').filter(l => l !== '')
  } catch {
    return []
  }
}

export function gitTopLevel(dir: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

export function today(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
