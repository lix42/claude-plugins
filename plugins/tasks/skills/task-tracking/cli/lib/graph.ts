import { cmp } from './model.ts'
import type { Plan, Task } from './model.ts'

export type Index = ReadonlyMap<string, Task>

export function indexTasks(plan: Plan): Index {
  return new Map(plan.tasks.map(t => [t.id, t]))
}

/** A dependency stops gating once it is done or closed. */
export function isSettled(t: Task | undefined): boolean {
  return t !== undefined && (t.status === 'done' || t.status === 'closed')
}

export function isOpen(t: Task): boolean {
  return t.status === 'todo' || t.status === 'doing'
}

export function unsettledDeps(task: Task, idx: Index): string[] {
  return task.deps.filter(d => !isSettled(idx.get(d)))
}

/** Direct dependents of each task (reverse edges). */
export function dependentsOf(plan: Plan): Map<string, string[]> {
  const out = new Map<string, string[]>(plan.tasks.map(t => [t.id, []]))
  for (const t of plan.tasks) for (const d of t.deps) out.get(d)?.push(t.id)
  for (const list of out.values()) list.sort(cmp)
  return out
}

export type Dangling = { id: string; field: 'deps' | 'related' | 'closed_into'; target: string }

export function danglingRefs(plan: Plan, idx: Index): Dangling[] {
  const out: Dangling[] = []
  for (const t of plan.tasks) {
    for (const d of t.deps) if (!idx.has(d)) out.push({ id: t.id, field: 'deps', target: d })
    for (const d of t.related) if (!idx.has(d)) out.push({ id: t.id, field: 'related', target: d })
    if (t.closedInto !== '' && !idx.has(t.closedInto))
      out.push({ id: t.id, field: 'closed_into', target: t.closedInto })
  }
  return out
}

/** Every cycle in the task graph, one per strongly connected component (Tarjan). */
export function cycles(plan: Plan, idx: Index): string[][] {
  const order = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const out: string[][] = []
  let counter = 0
  const visit = (id: string): void => {
    order.set(id, counter)
    low.set(id, counter)
    counter++
    stack.push(id)
    onStack.add(id)
    for (const d of idx.get(id)?.deps ?? []) {
      if (!idx.has(d)) continue
      if (!order.has(d)) {
        visit(d)
        low.set(id, Math.min(low.get(id)!, low.get(d)!))
      } else if (onStack.has(d)) {
        low.set(id, Math.min(low.get(id)!, order.get(d)!))
      }
    }
    if (low.get(id) !== order.get(id)) return
    const scc: string[] = []
    for (;;) {
      const top = stack.pop()!
      onStack.delete(top)
      scc.push(top)
      if (top === id) break
    }
    const selfLoop = scc.length === 1 && (idx.get(id)?.deps.includes(id) ?? false)
    if (scc.length > 1 || selfLoop) out.push(scc.sort(cmp))
  }
  for (const t of [...plan.tasks].sort((a, b) => cmp(a.id, b.id))) if (!order.has(t.id)) visit(t.id)
  return out
}

/** Transitive dependents of `id`, counting only open tasks. Assumes an acyclic graph. */
function openDownstream(id: string, rev: Map<string, string[]>, idx: Index, memo: Map<string, Set<string>>): Set<string> {
  const hit = memo.get(id)
  if (hit) return hit
  const out = new Set<string>()
  memo.set(id, out)
  for (const child of rev.get(id) ?? []) {
    const t = idx.get(child)
    if (t === undefined || !isOpen(t)) continue
    out.add(child)
    for (const g of openDownstream(child, rev, idx, memo)) out.add(g)
  }
  return out
}

function longestChain(id: string, rev: Map<string, string[]>, idx: Index, memo: Map<string, number>): number {
  const hit = memo.get(id)
  if (hit !== undefined) return hit
  memo.set(id, 0)
  let best = 0
  for (const child of rev.get(id) ?? []) {
    const t = idx.get(child)
    if (t !== undefined && isOpen(t)) best = Math.max(best, 1 + longestChain(child, rev, idx, memo))
  }
  memo.set(id, best)
  return best
}

export type ReadyItem = {
  id: string
  title: string
  priority: Task['priority']
  /** Open tasks that transitively wait on this one. */
  downstream: number
  /** Length of the longest open chain hanging off this one. */
  chain: number
  /** Direct dependents this would make ready on its own. */
  unblocks: string[]
}

export type ReadyReport = {
  ready: ReadyItem[]
  doing: string[]
  /** Open tasks marked `priority: blocked` whose deps are otherwise settled. */
  held: string[]
}

export function ready(plan: Plan, idx: Index): ReadyReport {
  const rev = dependentsOf(plan)
  const downMemo = new Map<string, Set<string>>()
  const chainMemo = new Map<string, number>()
  const items: ReadyItem[] = []
  const held: string[] = []
  for (const t of plan.tasks) {
    if (t.status !== 'todo' || unsettledDeps(t, idx).length > 0) continue
    if (t.priority === 'blocked') {
      held.push(t.id)
      continue
    }
    items.push({
      id: t.id,
      title: t.title,
      priority: t.priority,
      downstream: openDownstream(t.id, rev, idx, downMemo).size,
      chain: longestChain(t.id, rev, idx, chainMemo),
      unblocks: unblockedBy(t.id, plan, idx, rev),
    })
  }
  items.sort(
    (a, b) =>
      Number(a.priority === 'low') - Number(b.priority === 'low') ||
      b.downstream - a.downstream ||
      b.chain - a.chain ||
      cmp(a.id, b.id),
  )
  const doing = plan.tasks.filter(t => t.status === 'doing').map(t => t.id).sort(cmp)
  return { ready: items, doing, held: held.sort(cmp) }
}

/** Open direct dependents whose only unsettled dependency is `id`. */
export function unblockedBy(id: string, plan: Plan, idx: Index, rev = dependentsOf(plan)): string[] {
  if (isSettled(idx.get(id))) return []
  return (rev.get(id) ?? []).filter(child => {
    const t = idx.get(child)
    if (t === undefined || t.status !== 'todo') return false
    return unsettledDeps(t, idx).every(d => d === id)
  })
}

/** Transitive dependencies of `id`, nearest first. */
export function transitiveDeps(id: string, idx: Index): string[] {
  const seen = new Set<string>()
  const queue = [...(idx.get(id)?.deps ?? [])]
  while (queue.length > 0) {
    const d = queue.shift()!
    if (seen.has(d) || d === id) continue
    seen.add(d)
    queue.push(...(idx.get(d)?.deps ?? []))
  }
  return [...seen]
}

/** Would adding `dep` to `id`'s deps close a cycle? */
export function wouldCycle(id: string, dep: string, idx: Index): boolean {
  return dep === id || transitiveDeps(dep, idx).includes(id)
}

/** Epic-level edges projected from the open tasks' cross-epic deps. */
export function rollup(plan: Plan, idx: Index): [string, string][] {
  const edges = new Set<string>()
  for (const t of plan.tasks) {
    if (t.status === 'closed' || t.epic === null) continue
    for (const d of t.deps) {
      const dep = idx.get(d)
      if (dep?.epic != null && dep.epic !== t.epic) edges.add(`${dep.epic}\u0000${t.epic}`)
    }
  }
  return [...edges].sort(cmp).map(e => e.split('\u0000') as [string, string])
}
