import { cycles, danglingRefs, isOpen } from './graph.ts'
import type { Index } from './graph.ts'
import { dependencySectionIds } from './links.ts'
import { cmp, isValidId, progressPath, taskPath } from './model.ts'
import type { Plan } from './model.ts'
import { findSection } from './progress.ts'
import { renderIndex } from './render.ts'

export type Issue = { level: 'error' | 'warning'; path: string; message: string }

export type CheckInput = {
  plan: Plan
  idx: Index
  /** Parse problems from loading. */
  problems: { path: string; message: string }[]
  /** Current TASKS.md, or null if missing. */
  indexText: string | null
  /** Progress files by docs-relative path; null when missing. */
  progress: ReadonlyMap<string, string | null>
}

export function check(input: CheckInput): Issue[] {
  const { plan, idx } = input
  const out: Issue[] = input.problems.map(p => ({ level: 'error', ...p }))
  const err = (path: string, message: string): void => void out.push({ level: 'error', path, message })
  const warn = (path: string, message: string): void => void out.push({ level: 'warning', path, message })

  for (const t of plan.tasks) if (!isValidId(t.id, plan.mode)) err(taskPath(t.id), `invalid task id \`${t.id}\``)
  for (const d of danglingRefs(plan, idx)) err(taskPath(d.id), `\`${d.field}\` names unknown task \`${d.target}\``)
  for (const c of cycles(plan, idx)) err('tasks/', `dependency cycle: ${c.join(' → ')}`)

  const rendered = renderIndex(plan, idx)
  if (input.indexText === null) err('TASKS.md', 'missing; run `tasks render`')
  else if (input.indexText !== rendered) err('TASKS.md', 'out of date with the task files; run `tasks render`')

  const epicNames = new Set(plan.epics.map(e => e.name))
  const orders = new Map<number, string>()
  for (const e of plan.epics) {
    const other = orders.get(e.order)
    if (other !== undefined && e.order !== Number.MAX_SAFE_INTEGER)
      warn(`tasks/${e.name}/_epic.md`, `\`order: ${e.order}\` repeats \`${other}\`'s`)
    orders.set(e.order, e.name)
  }

  const missingLogs = new Map<string, string[]>()
  for (const t of [...plan.tasks].sort((a, b) => cmp(a.id, b.id))) {
    const path = taskPath(t.id)
    if (t.epic !== null && !epicNames.has(t.epic)) err(path, `epic \`${t.epic}\` has no directory`)
    if (isOpen(t)) {
      const closedDeps = t.deps.filter(d => idx.get(d)?.status === 'closed')
      if (closedDeps.length > 0)
        warn(path, `open task depends on closed ${closedDeps.map(d => `\`${d}\``).join(', ')}; re-point or drop`)
    }
    if (t.closedInto !== '' && t.status !== 'closed') warn(path, '`closed_into` set on a task that is not closed')

    if (!isOpen(t)) continue
    const linked = dependencySectionIds(t.id, t.body)?.filter(d => idx.has(d)) ?? null
    if (linked !== null) {
      const allowed = new Set([...t.deps, ...t.related])
      const missing = t.deps.filter(d => !linked.includes(d))
      const extra = linked.filter(d => !allowed.has(d))
      if (missing.length > 0 || extra.length > 0)
        warn(
          path,
          '`## Dependencies` prose disagrees with frontmatter' +
            (missing.length > 0 ? `; deps not named: ${missing.join(', ')}` : '') +
            (extra.length > 0 ? `; named but not in deps/related: ${extra.join(', ')}` : ''),
        )
    }

    const pp = progressPath(t)
    const text = input.progress.get(pp)
    if (text === undefined) continue
    if (text === null) missingLogs.set(pp, [...(missingLogs.get(pp) ?? []), t.id])
    else if (findSection(text.split('\n'), t.name) === null) warn(pp, `no \`## ${t.name}\` section for open task \`${t.id}\``)
  }
  for (const [pp, ids] of missingLogs) warn(pp, `missing; ${ids.length} open task(s) log here`)
  return dedupe(out)
}

function dedupe(issues: Issue[]): Issue[] {
  const seen = new Set<string>()
  return issues.filter(i => {
    const k = `${i.level}\u0000${i.path}\u0000${i.message}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}
