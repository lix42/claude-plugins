import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { migrate, summarize } from '../lib/migrate.ts'
import type { Task } from '../lib/model.ts'

const byId = (tasks: Task[]): Map<string, Task> => new Map(tasks.map(t => [t.id, t]))

describe('migrate: the documented epic format', () => {
  const tasksMd = `# Calc — Tasks

> **Progress log:** read it.

## Design

Pure core, thin UI.

## Dependencies

\`\`\`mermaid
graph TD
  core/types --> ui/buttons
\`\`\`

- \`core/types\`: (none)
- \`core/old\` (post-MVP, **closed: folded into \`core/types\`** 2026-01-02): (none)
- \`ui/buttons\` (new flow): \`core/types\`,
  \`ui/theme\`
  — filed 2026-01-01: wraps onto a continuation line
- \`ui/theme\`: (none)

## Tasks

**Legend:** \`[ ]\` not started · \`[~]\` in progress · \`[x]\` done

### core — [progress](progress/core.md)
> Shared types.

- [x] [Shared
  types](tasks/core/types.md) — the types. **Done 2026-01-05**: shipped as \`types.rs\`
- [x] [Old idea](tasks/core/old.md) — **closed—superseded** by \`core/types\`

### ui — [progress](progress/ui.md)
> Everything on screen.

- [~] [Buttons](tasks/ui/buttons.md) — the grid; **low priority**
- [ ] [Theme](tasks/ui/theme.md) — colours
`
  const files = [
    { id: 'core/types', text: '# Shared types\n\n## Goal\n\nTypes.\n' },
    { id: 'core/old', text: '# Old idea\n' },
    { id: 'ui/buttons', text: '# Buttons\n\n## Dependencies\n\n- [Types](../core/types.md)\n' },
    { id: 'ui/theme', text: '# Theme\n' },
    { id: 'ui/retired', text: '# Retired\n\n> **Superseded 2026-01-03 by `ui/theme`** — gone.\n' },
  ]
  const { plan, report } = migrate({ mode: 'epic', tasksMd, files, epicDirs: ['core', 'ui'], today: '2026-02-01' })
  const t = byId(plan.tasks)

  test('header keeps the design and drops the legend', () => {
    assert.match(plan.header, /^# Calc — Tasks/)
    assert.match(plan.header, /## Design\n\nPure core, thin UI\./)
    assert.doesNotMatch(plan.header, /Legend|## Dependencies/)
  })

  test('statuses, including closed markers and unlisted files', () => {
    assert.deepEqual(
      ['core/types', 'core/old', 'ui/buttons', 'ui/theme', 'ui/retired'].map(id => t.get(id)!.status),
      ['done', 'closed', 'doing', 'todo', 'closed'],
    )
    assert.deepEqual(report.unlisted, ['ui/retired'])
    assert.equal(t.get('core/old')!.closedInto, 'core/types')
    assert.equal(t.get('ui/retired')!.closedInto, 'ui/theme')
  })

  test('deps come from the list, including ids wrapped onto continuation lines', () => {
    assert.deepEqual(t.get('ui/buttons')!.deps, ['core/types', 'ui/theme'])
    assert.deepEqual(report.disagreements, [{ id: 'ui/buttons', kept: ['core/types', 'ui/theme'], file: ['core/types'] }])
    assert.equal(report.depsSource.list, 4)
  })

  test('fields: title from the file, summary, done date, tags, priority', () => {
    const types = t.get('core/types')!
    assert.equal(types.title, 'Shared types')
    assert.equal(types.summary, 'the types')
    assert.equal(types.done, '2026-01-05')
    assert.deepEqual(t.get('core/old')!.tags, ['post-mvp'])
    assert.deepEqual(t.get('ui/buttons')!.tags, ['new-flow'])
    assert.equal(t.get('ui/buttons')!.priority, 'low')
    assert.equal(t.get('ui/buttons')!.summary, 'the grid')
  })

  test('text that fits no field is kept in the body', () => {
    assert.match(t.get('core/types')!.body, /^# Shared types\n\n> \*\*From TASKS\.md\*\* \(migrated 2026-02-01\): the types\. \*\*Done 2026-01-05\*\*: shipped as `types\.rs`\n\n## Goal/)
    assert.match(t.get('ui/buttons')!.body, /\*\*Dependency note\*\* \(migrated 2026-02-01\): filed 2026-01-01: wraps onto a continuation line/)
    assert.equal(t.get('ui/theme')!.body, '# Theme\n')
  })

  test('epics in heading order with blurbs', () => {
    assert.deepEqual(plan.epics.map(e => [e.name, e.order, e.blurb]), [['core', 1, 'Shared types.'], ['ui', 2, 'Everything on screen.']])
  })
})

describe('migrate: an unlinked checklist with "Depends" prose (tui-calculator)', () => {
  const tasksMd = `# Tasks

[x] eval-parser: Expression parser and evaluator
[x] app-state: Application state. Depends (hard): eval-parser.
[x] old-result: absorbed by app-state — verified. See tasks/old-result.md.

## Planned
[ ] rainbow: Rainbow mode. Depends (soft): app-state.
[-] web-big: split into web-a below.
[ ] web-a: Web entry. Depends: none (soft: rainbow for timing).
`
  const files = [
    { id: 'eval-parser', text: '# Expression parser\n' },
    { id: 'app-state', text: '# Application state\n\n## Dependencies\n\n- **eval-parser** — calls eval()\n' },
    { id: 'old-result', text: '# Old result\n' },
    { id: 'rainbow', text: '# Rainbow\n' },
    { id: 'web-big', text: '# Web (big)\n' },
  ]
  const { plan, report } = migrate({ mode: 'flat', tasksMd, files, epicDirs: [], today: '2026-02-01' })
  const t = byId(plan.tasks)

  test('statuses, closed-into and stubs', () => {
    assert.equal(t.get('old-result')!.status, 'closed')
    assert.equal(t.get('old-result')!.closedInto, 'app-state')
    assert.equal(t.get('web-big')!.status, 'closed')
    assert.deepEqual(report.stubs, ['web-a'])
    assert.equal(t.get('web-a')!.body, '# Web entry\n\n> **Dependency note** (migrated 2026-02-01): Depends: none (soft: rainbow for timing)\n\n## Goal\n\nWeb entry.\n')
  })

  test('hard, soft and none clauses', () => {
    assert.deepEqual(t.get('app-state')!.deps, ['eval-parser'])
    assert.deepEqual(t.get('rainbow')!.deps, [])
    assert.deepEqual(t.get('rainbow')!.related, ['app-state'])
    assert.deepEqual(t.get('web-a')!.related, ['rainbow'])
    assert.equal(report.noneClauses.length, 1)
    assert.deepEqual(report.disagreements, [])
    assert.equal(t.get('app-state')!.title, 'Application state')
    assert.equal(t.get('app-state')!.summary, '', 'a summary repeating the title is dropped')
  })

  test('phase headings are not epics and the header stops at them', () => {
    assert.equal(plan.header, '# Tasks')
    assert.deepEqual(plan.epics, [])
    assert.deepEqual(report.unparsed, [])
  })
})

describe('migrate: linked checklist, deps only in task files (rev)', () => {
  const tasksMd = `# rev — Project Tasks

**Legend:** \`[ ]\` = not started

---

## Story 1: Basic

> Goal: a viewer.

- [x] [Repo detection](tasks/repo.md)
- [ ] [Diff](tasks/diff.md)
`
  const files = [
    { id: 'repo', text: '# Repo detection\n\n## Dependencies\n\nNone.\n' },
    { id: 'diff', text: '# Diff\n\n## Dependencies\n\n- [repo](repo.md)\n' },
  ]
  const { plan, report } = migrate({ mode: 'flat', tasksMd, files, epicDirs: [], today: '2026-02-01' })

  test('deps fall back to the files, header stops before the first story', () => {
    assert.deepEqual(byId(plan.tasks).get('diff')!.deps, ['repo'])
    assert.equal(report.depsSource.file, 1)
    assert.equal(plan.header, '# rev — Project Tasks')
  })
})

describe('summarize', () => {
  test('cuts at the status narrative and the first clause break', () => {
    assert.equal(summarize('the look half of `gamma`; supersedes x. **Done 2026-09-24**: one knob'), 'the look half of `gamma`')
    assert.equal(summarize('**done 2026-09-29: a multiplier on the base slope** (the roll\'s)'), 'a multiplier on the base slope')
    assert.equal(summarize('**closed—moot** (2026-09-27): gone'), '')
    assert.equal(summarize('**low priority**: whether saturation follows'), 'whether saturation follows')
  })
})
