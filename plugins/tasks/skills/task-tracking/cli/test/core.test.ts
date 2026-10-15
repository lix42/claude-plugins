import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { serializeFrontmatter, splitFrontmatter } from '../lib/frontmatter.ts'
import { cycles, indexTasks, ready, rollup, unblockedBy } from '../lib/graph.ts'
import { dependencySectionIds, relativeTo, rewriteLinks } from '../lib/links.ts'
import { parseTask, serializeTask } from '../lib/model.ts'
import type { Plan, Task } from '../lib/model.ts'
import { applySet, planMove, resolveId, syncDependencySection } from '../lib/ops.ts'
import { appendEntry, findSection, setStatusMirror, takeSection } from '../lib/progress.ts'
import { renderIndex } from '../lib/render.ts'

function task(id: string, over: Partial<Task> = {}): Task {
  const at = id.indexOf('/')
  return {
    id,
    epic: at < 0 ? null : id.slice(0, at),
    name: at < 0 ? id : id.slice(at + 1),
    title: id,
    status: 'todo',
    deps: [],
    related: [],
    priority: null,
    tags: [],
    summary: '',
    done: '',
    closedInto: '',
    body: `# ${id}\n`,
    ...over,
  }
}

function flat(...tasks: Task[]): Plan {
  return { mode: 'flat', header: '# P — Tasks', epics: [], tasks }
}

describe('frontmatter', () => {
  test('round-trips scalars that need quoting and lists', () => {
    const fields: [string, string | string[]][] = [
      ['title', '`--contrast` and what it means'],
      ['summary', 'a: b # not a comment'],
      ['done', '2026-10-01'],
      ['order', '12'],
      ['flag', 'yes'],
      ['deps', ['a/b', 'c-d']],
      ['tags', []],
    ]
    const text = serializeFrontmatter(fields) + 'body\n'
    assert.match(text, /^title: "`--contrast` and what it means"$/m)
    assert.match(text, /^done: 2026-10-01$/m)
    assert.match(text, /^order: 12$/m)
    assert.match(text, /^flag: "yes"$/m)
    const back = splitFrontmatter(text)
    assert.deepEqual(back.fields, fields)
    assert.equal(back.body, 'body\n')
    assert.deepEqual(back.errors, [])
  })

  test('reports malformed lines and a missing close', () => {
    assert.match(splitFrontmatter('---\nnot a field\n---\n').errors[0]!, /expected `key: value`/)
    assert.match(splitFrontmatter('---\ntitle: x\n').errors[0]!, /no closing/)
    assert.equal(splitFrontmatter('# no frontmatter\n').fields, null)
  })
})

describe('task model', () => {
  test('parses, validates and serializes in a fixed key order', () => {
    const text = '---\nstatus: doing\ntitle: T\ndeps: [x]\npriority: low\n---\n# T\n'
    const { value, errors } = parseTask('a', text)
    assert.deepEqual(errors, [])
    assert.equal(value.status, 'doing')
    assert.equal(serializeTask(value), '---\ntitle: T\nstatus: doing\ndeps: [x]\npriority: low\n---\n# T\n')
  })

  test('rejects unknown keys, bad values and wrong shapes', () => {
    const { errors } = parseTask('a', '---\ntitle: T\nstatus: finished\nowner: me\ndeps: x\n---\n')
    assert.equal(errors.length, 3)
    assert.match(errors.join('\n'), /`status` must be one of/)
    assert.match(errors.join('\n'), /unknown key `owner`/)
    assert.match(errors.join('\n'), /`deps` must be a list/)
  })
})

describe('graph', () => {
  const plan = flat(
    task('base', { status: 'done' }),
    task('old', { status: 'closed' }),
    task('a', { deps: ['base'] }),
    task('b', { deps: ['a'] }),
    task('c', { deps: ['a', 'b'] }),
    task('d', { deps: ['old'], priority: 'low' }),
    task('e', { priority: 'blocked' }),
    task('w', { status: 'doing' }),
  )
  const idx = indexTasks(plan)

  test('ready: deps settled, ranked by leverage, low priority last, blocked held', () => {
    const r = ready(plan, idx)
    assert.deepEqual(r.ready.map(x => x.id), ['a', 'd'])
    assert.equal(r.ready[0]!.downstream, 2)
    assert.equal(r.ready[0]!.chain, 2)
    assert.deepEqual(r.ready[0]!.unblocks, ['b'])
    assert.deepEqual(r.held, ['e'])
    assert.deepEqual(r.doing, ['w'])
  })

  test('unblockedBy only counts dependents waiting on nothing else', () => {
    assert.deepEqual(unblockedBy('a', plan, idx), ['b'])
    assert.deepEqual(unblockedBy('b', plan, idx), [])
  })

  test('cycles are found, including self-loops', () => {
    const p = flat(task('x', { deps: ['y'] }), task('y', { deps: ['x'] }), task('z', { deps: ['z'] }))
    assert.deepEqual(cycles(p, indexTasks(p)), [['x', 'y'], ['z']])
  })

  test('rollup projects open cross-epic edges only', () => {
    const p: Plan = {
      mode: 'epic',
      header: '',
      epics: [],
      tasks: [
        task('core/t'),
        task('ui/b', { deps: ['core/t'] }),
        task('ui/c', { deps: ['ui/b'] }),
        task('io/x', { deps: ['ui/b'], status: 'closed' }),
      ],
    }
    assert.deepEqual(rollup(p, indexTasks(p)), [['core', 'ui']])
  })
})

describe('render', () => {
  test('flat index: open first, waits-on for unsettled deps, closed last', () => {
    const plan = flat(
      task('base', { status: 'done', title: 'Base', summary: 'the base' }),
      task('next', { deps: ['base', 'other'], title: 'Next' }),
      task('other', { status: 'doing', title: 'Other' }),
      task('gone', { status: 'closed', closedInto: 'next', title: 'Gone' }),
    )
    const out = renderIndex(plan, indexTasks(plan))
    const items = out.split('\n').filter(l => l.startsWith('- ['))
    assert.deepEqual(items, [
      '- [~] [Other](tasks/other.md)',
      '- [ ] [Next](tasks/next.md) — **waits on** `other`',
      '- [x] [Base](tasks/base.md) — the base',
      '- [-] [Gone](tasks/gone.md) — closed into `next`',
    ])
    assert.match(out, /^ {2}base --> next$/m)
    assert.doesNotMatch(out, /^ {2}gone$/m)
  })

  test('epic index: headings in order with blurbs, rollup declares every epic', () => {
    const plan: Plan = {
      mode: 'epic',
      header: '# P — Tasks',
      epics: [
        { name: 'ui', title: 'ui', order: 2, blurb: 'Screens.' },
        { name: 'core', title: 'core', order: 1, blurb: '' },
      ],
      tasks: [task('core/t', { status: 'done' }), task('ui/b', { deps: ['core/t'] })],
    }
    const out = renderIndex(plan, indexTasks(plan))
    assert.ok(out.indexOf('### core') < out.indexOf('### ui'))
    assert.match(out, /### ui — \[progress\]\(progress\/ui\.md\)\n> Screens\./)
    assert.match(out, /graph TD\n {2}core\n {2}ui\n {2}core --> ui/)
  })
})

describe('progress log', () => {
  const log = '# Log\n\n## alpha — `src/a.rs`\n\n**Status:** not started\n**Updated:** 2026-01-01\n\n- 2026-01-01: filed.\n\n## beta\n\n- x\n'

  test('finds a section whose heading adds text after the name, not a prefix of another name', () => {
    const lines = log.split('\n')
    assert.equal(findSection(lines, 'alpha')?.start, 2)
    assert.equal(findSection(lines, 'alp'), null)
  })

  test('appends after the last entry and bumps Updated', () => {
    const out = appendEntry(log, 'alpha', '2026-02-02', 'did it\nand more', 'in progress')
    assert.match(out, /- 2026-01-01: filed\.\n- 2026-02-02: did it\n {2}and more\n\n## beta/)
    assert.match(out, /\*\*Updated:\*\* 2026-02-02/)
  })

  test('creates a missing section at the end', () => {
    const out = appendEntry(log, 'gamma', '2026-02-02', 'new', 'not started')
    assert.match(out, /- x\n\n## gamma\n\n\*\*Status:\*\* not started\n\*\*Updated:\*\* 2026-02-02\n\n- 2026-02-02: new\n$/)
  })

  test('a heading inside a code fence does not end the section', () => {
    const text = '## a\n\n- x\n  ```sh\n# install\n  ```\n- y\n\n## b\n'
    assert.match(appendEntry(text, 'a', '2026-02-02', 'z', 'done'), /- y\n- 2026-02-02: z\n\n## b/)
  })

  test('status mirror and moving a section out', () => {
    assert.match(setStatusMirror(log, 'alpha', 'done', '2026-03-03')!, /\*\*Status:\*\* done\n\*\*Updated:\*\* 2026-03-03/)
    const taken = takeSection(log, 'beta', 'renamed')!
    assert.deepEqual(taken.section, ['## renamed', '', '- x'])
    assert.ok(taken.rest.endsWith('- 2026-01-01: filed.\n'))
  })
})

describe('links', () => {
  test('relative paths', () => {
    assert.equal(relativeTo('tasks/a', 'tasks/b/x.md'), '../b/x.md')
    assert.equal(relativeTo('tasks/a', 'tasks/a/x.md'), 'x.md')
    assert.equal(relativeTo('', 'tasks/a/x.md'), 'tasks/a/x.md')
  })

  test('a moved file re-bases its own links and others repoint theirs', () => {
    const own = 'see [d](../spec/d.md#s) and [s](sib.md) and [w](https://x.y)'
    assert.equal(
      rewriteLinks(own, 'tasks/a', 'tasks/b', new Map([['tasks/a/me.md', 'tasks/b/me.md']])),
      'see [d](../spec/d.md#s) and [s](../a/sib.md) and [w](https://x.y)',
    )
    const other = 'needs [me](../a/me.md) and [y](y.md)'
    assert.equal(rewriteLinks(other, 'tasks/c', 'tasks/c', new Map([['tasks/a/me.md', 'tasks/b/me.md']])), 'needs [me](../b/me.md) and [y](y.md)')
  })

  test('reference definitions and HTML links move too', () => {
    const text = 'use [spec][s]\n\n[s]: ../design.md#top\n<a href="x/me.md">me</a>\n'
    assert.equal(
      rewriteLinks(text, 'tasks', 'tasks/e', new Map([['tasks/x/me.md', 'tasks/y/me.md']])),
      'use [spec][s]\n\n[s]: ../../design.md#top\n<a href="../y/me.md">me</a>\n',
    )
  })

  test('footnotes, prose labels, bare words and fenced code are left alone', () => {
    const text = '[^1]: See the docs\n[Decision]: use X\nsee [x](TODO)\n```\n[a](../a.md)\n```\n[b](../b.md)\n'
    assert.equal(
      rewriteLinks(text, 'tasks', 'tasks/e', new Map()),
      '[^1]: See the docs\n[Decision]: use X\nsee [x](TODO)\n```\n[a](../a.md)\n```\n[b](../../b.md)\n',
    )
  })

  test('dependency sections name ids by link or bold', () => {
    const body = '# T\n\n## Dependencies\n\n- [A](../x/a.md)\n- **x/b** — reason\n\n## Notes\n\n[n](../x/n.md)\n'
    assert.deepEqual(dependencySectionIds('y/t', body), ['x/a', 'x/b'])
    assert.equal(dependencySectionIds('y/t', '# T\n'), null)
  })
})

describe('ops', () => {
  const plan = flat(task('a'), task('b', { deps: ['a'] }), task('c'))
  const idx = indexTasks(plan)

  test('set handles scalars, list ops and refuses cycles and unknown ids', () => {
    const r = applySet(idx.get('c')!, ['status=doing', 'deps+=a,b', 'tags=x', 'priority=low'], idx)
    assert.ok(r.ok)
    if (r.ok) assert.deepEqual([r.value.status, r.value.deps, r.value.tags, r.value.priority], ['doing', ['a', 'b'], ['x'], 'low'])
    const cyc = applySet(idx.get('a')!, ['deps+=b'], idx)
    assert.ok(!cyc.ok && cyc.errors[0]!.includes('cycle'))
    const unk = applySet(idx.get('a')!, ['deps+=zzz', 'status=nope', 'owner=me'], idx)
    assert.ok(!unk.ok && unk.errors.length === 3)
  })

  test('a dependency section follows deps added and removed', () => {
    const t = task('e/t', { body: '# T\n\n## Dependencies\n\nNone — standalone.\n\n## Notes\n' })
    const i = indexTasks({ mode: 'epic', header: '', epics: [], tasks: [t, task('e/a', { title: 'A' }), task('f/b')] })
    const added = syncDependencySection(t, ['e/a', 'f/b'], [], i)
    assert.equal(added, '# T\n\n## Dependencies\n\n- [A](a.md)\n- [f/b](../f/b.md)\n\n## Notes\n')
    const removed = syncDependencySection({ ...t, body: added }, [], ['e/a'], i)
    assert.equal(removed, '# T\n\n## Dependencies\n\n- [f/b](../f/b.md)\n\n## Notes\n')
  })

  test('move rewrites references, links and the moved file', () => {
    const p: Plan = {
      mode: 'epic',
      header: '',
      epics: [],
      tasks: [
        task('x/a', { body: '# A\n[sib](s.md)\n' }),
        task('x/s'),
        task('y/b', { deps: ['x/a'], body: '# B\n[a](../x/a.md)\n' }),
      ],
    }
    const r = planMove(p, 'x/a', 'z/a2', indexTasks(p))
    assert.ok(r.ok)
    if (!r.ok) return
    const byId = new Map(r.value.changed.map(t => [t.id, t]))
    assert.deepEqual([...byId.keys()].sort(), ['y/b', 'z/a2'])
    assert.equal(byId.get('z/a2')!.body, '# A\n[sib](../x/s.md)\n')
    assert.deepEqual(byId.get('y/b')!.deps, ['z/a2'])
    assert.equal(byId.get('y/b')!.body, '# B\n[a](../z/a2.md)\n')
  })

  test('resolveId accepts exact ids, unique names and unique substrings', () => {
    const ids = ['core/types', 'ui/types-view', 'ui/button']
    assert.deepEqual(resolveId('button', ids), { ok: true, value: 'ui/button' })
    assert.deepEqual(resolveId('types', ids), { ok: true, value: 'core/types' })
    assert.ok(!resolveId('typ', ids).ok)
    assert.ok(!resolveId('nope', ids).ok)
  })
})
