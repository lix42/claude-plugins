import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'

const CLI = join(import.meta.dirname, '..', 'tasks.ts')

type Run = { code: number; out: string }

function run(cwd: string, ...args: string[]): Run {
  try {
    const out = execFileSync('node', [CLI, '--date', '2026-03-01', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' })
    return { code: 0, out }
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string }
    return { code: err.status, out: err.stdout + err.stderr }
  }
}

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tasks-cli-'))
  mkdirSync(join(dir, 'docs'))
  return dir
}

const docs = (dir: string, path: string): string => readFileSync(join(dir, 'docs', path), 'utf8')

describe('flat plan, end to end', () => {
  const dir = project()

  test('init, new, ready', () => {
    assert.equal(run(dir, 'init', '--title', 'Calc').code, 0)
    assert.equal(run(dir, 'new', 'parser', '--title', 'Parser', '--summary', 'parse it').code, 0)
    assert.equal(run(dir, 'new', 'ui', '--title', 'UI', '--deps', 'parser').code, 0)
    const r = run(dir, 'ready')
    assert.match(r.out, /parser — Parser\n {6}downstream 1 · chain 1 · unblocks ui/)
    assert.doesNotMatch(r.out, /^ {2}ui/m)
    assert.match(docs(dir, 'progress.md'), /## parser\n\n\*\*Status:\*\* not started\n\*\*Updated:\*\* 2026-03-01\n\n- 2026-03-01: filed\. Goal: parse it/)
    assert.equal(run(dir, 'check').code, 0)
  })

  test('set done reports what opened up and mirrors the log status', () => {
    const r = run(dir, 'set', 'parser', 'status=done')
    assert.match(r.out, /Now ready: ui/)
    assert.match(docs(dir, 'progress.md'), /## parser\n\n\*\*Status:\*\* done/)
    assert.match(docs(dir, 'TASKS.md'), /- \[x\] \[Parser\]\(tasks\/parser\.md\) — parse it/)
  })

  test('log appends; --status moves the task', () => {
    assert.equal(run(dir, 'log', 'ui', '--status', 'doing', 'started the grid').code, 0)
    assert.match(docs(dir, 'progress.md'), /## ui\n\n\*\*Status:\*\* in progress\n\*\*Updated:\*\* 2026-03-01\n\n- 2026-03-01: started the grid\n$/)
    assert.match(docs(dir, 'tasks/ui.md'), /^status: doing$/m)
  })

  test('check catches a hand-edited index and bad frontmatter', () => {
    writeFileSync(join(dir, 'docs/TASKS.md'), docs(dir, 'TASKS.md') + 'edited\n')
    const stale = run(dir, 'check')
    assert.equal(stale.code, 1)
    assert.match(stale.out, /TASKS\.md: out of date/)
    assert.equal(run(dir, 'render').code, 0)
    assert.equal(run(dir, 'check').code, 0)
    writeFileSync(join(dir, 'docs/tasks/ui.md'), docs(dir, 'tasks/ui.md').replace('status: doing', 'status: wip'))
    assert.match(run(dir, 'check').out, /`status` must be one of/)
  })
})

describe('epic plan, end to end', () => {
  const dir = project()

  test('new creates epics and their logs; mv moves file, refs and log section', () => {
    run(dir, 'init', '--epics', '--title', 'App')
    run(dir, 'new', 'core/types', '--title', 'Types')
    run(dir, 'new', 'ui/buttons', '--title', 'Buttons', '--deps', 'types')
    assert.match(docs(dir, 'tasks/ui/_epic.md'), /^title: ui\norder: 2$/m)
    assert.match(docs(dir, 'progress/ui.md'), /## Epic summary[\s\S]*## buttons/)
    run(dir, 'log', 'buttons', 'a note')
    const mv = run(dir, 'mv', 'core/types', 'ui/types')
    assert.equal(mv.code, 0, mv.out)
    assert.ok(!existsSync(join(dir, 'docs/tasks/core/types.md')))
    assert.match(docs(dir, 'tasks/ui/buttons.md'), /^deps: \[ui\/types\]$/m)
    assert.match(docs(dir, 'progress/ui.md'), /## types\n/)
    assert.doesNotMatch(docs(dir, 'progress/core.md'), /## types/)
    assert.equal(run(dir, 'check').code, 0)
  })

  test('refuses cycles and unknown ids without writing', () => {
    const before = docs(dir, 'tasks/ui/types.md')
    assert.match(run(dir, 'set', 'ui/types', 'deps+=buttons').out, /cycle/)
    assert.match(run(dir, 'set', 'nope', 'status=done').out, /no task matches/)
    assert.equal(docs(dir, 'tasks/ui/types.md'), before)
  })

  test('json output', () => {
    const r = JSON.parse(run(dir, 'ready', '--json').out) as { ready: { id: string }[] }
    assert.deepEqual(r.ready.map(x => x.id), ['ui/types'])
  })
})

describe('migrate, end to end', () => {
  test('converts a legacy plan, refuses to run twice, and the result checks clean', () => {
    const dir = project()
    mkdirSync(join(dir, 'docs/tasks'))
    writeFileSync(
      join(dir, 'docs/TASKS.md'),
      '# Old — Tasks\n\n## Dependencies\n\n- `a`: (none)\n- `b`: `a`\n\n## Tasks\n\n- [x] [A](tasks/a.md)\n- [ ] [B](tasks/b.md) — the b\n',
    )
    writeFileSync(join(dir, 'docs/tasks/a.md'), '# A\n')
    writeFileSync(join(dir, 'docs/tasks/b.md'), '# B\n')
    writeFileSync(join(dir, 'docs/progress.md'), '# Log\n\n## b\n\n- x\n')
    assert.match(run(dir, 'ready').out, /run `tasks migrate --dry-run`/)
    assert.match(run(dir, 'migrate', '--dry-run').out, /Dry run: 2 tasks/)
    assert.doesNotMatch(docs(dir, 'tasks/b.md'), /^---/)
    assert.equal(run(dir, 'migrate').code, 0)
    assert.match(docs(dir, 'tasks/b.md'), /^---\ntitle: B\nstatus: todo\ndeps: \[a\]\nsummary: the b\n---\n# B\n$/)
    assert.equal(docs(dir, 'tasks/_header.md'), '# Old — Tasks\n')
    assert.equal(run(dir, 'check').code, 0)
    assert.match(run(dir, 'migrate').out, /already generated/)
  })
})

describe('group, end to end', () => {
  test('promotes a flat plan: ids, deps, links and the progress log move to epics', () => {
    const dir = project()
    execFileSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8' })
    run(dir, 'init', '--title', 'G')
    run(dir, 'new', 'types', '--title', 'Types')
    run(dir, 'new', 'ui-grid', '--title', 'Grid', '--deps', 'types')
    run(dir, 'log', 'ui-grid', 'see [types](tasks/types.md)')
    writeFileSync(join(dir, 'docs/progress.md'), docs(dir, 'progress.md') + '\n## Known issues\n\n- one\n')
    writeFileSync(join(dir, 'docs/notes.md'), '[grid](tasks/ui-grid.md)\n')
    writeFileSync(join(dir, 'README.md'), 'see docs/tasks/ui-grid.md\n')
    writeFileSync(join(dir, 'map.json'), JSON.stringify({ epics: [{ name: 'core', blurb: 'Types.', tasks: ['types'] }, { name: 'ui', tasks: [{ from: 'ui-grid', name: 'grid' }] }] }))
    assert.match(run(dir, 'group', 'map.json').out, /commit or stash/)
    execFileSync('git', ['add', '-A'], { cwd: dir, encoding: 'utf8' })
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base'], { cwd: dir, encoding: 'utf8' })
    const r = run(dir, 'group', 'map.json')
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /parked in progress\/_unassigned\.md: \(preamble\); ## Known issues/)
    assert.match(r.out, /README\.md:1:see docs\/tasks\/ui-grid\.md/)
    assert.ok(!existsSync(join(dir, 'docs/progress.md')))
    assert.match(docs(dir, 'tasks/ui/grid.md'), /^deps: \[core\/types\]$/m)
    assert.match(docs(dir, 'progress/ui.md'), /## grid[\s\S]*see \[types\]\(\.\.\/tasks\/core\/types\.md\)/)
    assert.match(docs(dir, 'progress/_unassigned.md'), /## Original progress\.md preamble\n\n### G — Progress Log[\s\S]*## Known issues\n\n- one/)
    assert.equal(docs(dir, 'notes.md'), '[grid](tasks/ui/grid.md)\n')
    assert.match(docs(dir, 'TASKS.md'), /### core — \[progress\]\(progress\/core\.md\)\n> Types\./)
    assert.equal(run(dir, 'check').code, 0)
  })
})

describe('review regressions', () => {
  test('writes refuse while a task file has frontmatter the parser rejects', () => {
    const dir = project()
    run(dir, 'init')
    run(dir, 'new', 'a', '--title', 'A')
    const bad = docs(dir, 'tasks/a.md').replace('deps: []', 'deps: []\nowner: me')
    writeFileSync(join(dir, 'docs/tasks/a.md'), bad)
    const r = run(dir, 'set', 'a', 'status=doing')
    assert.equal(r.code, 1)
    assert.match(r.out, /unknown key `owner`/)
    assert.equal(docs(dir, 'tasks/a.md'), bad)
    assert.match(run(dir, 'set', 'a', 'summary=two\nlines').out, /unknown key|one line/)
  })

  test('multi-line values are refused; text starting with "-" goes after --', () => {
    const dir = project()
    run(dir, 'init')
    run(dir, 'new', 'a', '--title', 'A')
    assert.match(run(dir, 'set', 'a', 'summary=one\ntwo').out, /must be one line/)
    assert.match(run(dir, 'log', 'a', '-x').out, /after `--`/)
    assert.equal(run(dir, 'log', 'a', '--', '- fixed it').code, 0)
    assert.match(docs(dir, 'progress.md'), /- 2026-03-01: - fixed it/)
  })
})
