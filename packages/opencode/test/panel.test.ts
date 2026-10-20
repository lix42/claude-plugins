import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPanel } from '../src/panel.ts'
import { GRAPH, REF, VIEW } from '../../../plugins/pr-panel/tests/fixtures'
import { checkID, type FixTarget, type PanelState } from '../src/rpc.ts'

function fake() {
  let view: Record<string, unknown> = { ...VIEW, mergeStateStatus: 'CLEAN' }
  let branch = { exitCode: 0, stdout: '{}', stderr: '' }
  const calls: string[][] = []
  const told: string[] = []
  let notices = 0
  const panel = createPanel({
    run: async argv => {
      calls.push([...argv])
      if (argv.includes('url,state')) return branch
      let stdout = '{}'
      if (argv.includes('-i')) stdout = 'HTTP/2.0 200 OK\nEtag: W/"1"\n\n{}'
      else if (argv[1] === 'pr' && argv[2] === 'view') stdout = JSON.stringify(view)
      else if (argv[1] === 'api' && argv[2] === 'graphql') stdout = JSON.stringify(GRAPH)
      return { exitCode: 0, stdout, stderr: '' }
    },
    changed: () => { notices++ },
    notify: async () => {},
    tellAgent: async text => { told.push(text) },
  })
  return { panel, calls, told, notices: () => notices, setView: (next: Record<string, unknown>) => { view = next }, view: () => view,
    setBranch: (next: typeof branch) => { branch = next } }
}

test('opening an empty panel retries after no PR, a transient failure, or untracking', async () => {
  for (const branch of [{ exitCode: 0, stdout: '{}', stderr: '' }, { exitCode: 1, stdout: '', stderr: 'not authenticated' }]) {
    const f = fake()
    f.setBranch(branch)
    await f.panel.start()
    assert.equal(f.panel.state.prs.length, 0)
    f.setBranch({ exitCode: 0, stdout: JSON.stringify({ url: REF.url, state: 'OPEN' }), stderr: '' })
    assert.equal(await f.panel.command(''), 'PR panel opened.')
    await f.panel.command('untrack', REF.url)
    assert.equal(f.panel.state.prs.length, 0)
    assert.equal(await f.panel.command(''), 'PR panel opened.')
    assert.equal(f.calls.filter(argv => argv.includes('url,state')).length, 3)
  }
})

test('concurrent startup and empty-panel opens share discovery, but later opens retry', async () => {
  const f = fake()
  const started = f.panel.start()
  assert.equal(f.panel.start(), started)
  await Promise.all([started, f.panel.command(''), f.panel.command('')])
  assert.equal(f.calls.filter(argv => argv.includes('url,state')).length, 1)
  await f.panel.command('')
  assert.equal(f.calls.filter(argv => argv.includes('url,state')).length, 2)
})

test('tracks and selects a PR; session state is independent', async () => {
  const a = fake(), b = fake()
  await a.panel.command(REF.url)
  assert.equal(a.panel.state.prs.length, 1)
  assert.equal(a.panel.state.selected, REF.url)
  assert.equal(b.panel.state.prs.length, 0)
  assert.ok(a.notices() > 0)
  await a.panel.command('untrack', REF.url)
  assert.equal(a.panel.state.prs.length, 0)
})

test('observes successful gh PR creation output', async () => {
  const { panel } = fake()
  await panel.observe('gh pr create --title test', `${REF.url}\n`)
  assert.equal(panel.state.prs[0].ref.url, REF.url)
})

test('read-only refresh and fix preparation never send prompts or mutate GitHub', async () => {
  const { panel, calls, told } = fake()
  await panel.command(REF.url)
  await panel.refresh(REF.url)
  const s = panel.state.prs[0].snapshot!
  const text = await panel.fix({ url: REF.url, kind: 'thread', itemID: s.threads[0].id })
  assert.ok(text.includes(s.threads[0].body))
  assert.equal(told.length, 0)
  assert.ok(!calls.some(argv => argv[1] === 'pr' && argv[2] === 'merge'))
})

test('Fix retains the displayed PR and thread identity across reordering and selection changes', async () => {
  const { panel } = fake()
  await panel.command(REF.url)
  const snapshot = panel.state.prs[0].snapshot!
  const thread = snapshot.threads[0]
  const target: FixTarget = { url: REF.url, kind: 'thread', itemID: thread.id }
  const other = { ...thread, id: 'another-thread', body: 'Do not fix this other thread' }
  snapshot.threads = [other, thread]
  await panel.command('https://github.com/acme/app/pull/43')
  panel.selected()!.snapshot!.threads = [other]
  const text = await panel.fix(target)
  assert.ok(text.includes(thread.body))
  assert.ok(text.includes('#42'))
  assert.ok(!text.includes(other.body))
  snapshot.threads = [other]
  await assert.rejects(panel.fix(target), /Thread no longer exists/)
  panel.state.prs = panel.state.prs.filter(pr => pr.ref.url !== REF.url)
  await assert.rejects(panel.fix(target), /PR is no longer tracked/)
})

test('Fix binds failed checks to their workflow, run, details URL, and head', async () => {
  const { panel } = fake()
  await panel.command(REF.url)
  const snapshot = panel.state.prs[0].snapshot!
  const check = snapshot.checks[0]
  const target: FixTarget = { url: REF.url, kind: 'check', itemID: checkID(check), headSha: snapshot.headSha }
  const other = { ...check, workflow: 'Other workflow', runId: '999', url: 'https://github.com/acme/app/actions/runs/999/job/333' }
  snapshot.checks = [other, check]
  assert.ok((await panel.fix(target)).includes(check.url!))
  snapshot.checks = [other]
  await assert.rejects(panel.fix(target), /no longer exists/)
  snapshot.checks = [check, { ...check }]
  await assert.rejects(panel.fix(target), /ambiguous/)
  snapshot.checks = [{ ...check, state: 'pass' }]
  await assert.rejects(panel.fix(target), /no longer exists/)
  snapshot.checks = [check]
  snapshot.headSha = 'new-head'
  await assert.rejects(panel.fix(target), /PR head changed/)
})

test('concurrent thread Fix requests capture independent drafts', async () => {
  const { panel } = fake()
  await panel.command(REF.url)
  const snapshot = panel.state.prs[0].snapshot!
  const one = snapshot.threads[0]
  const two = { ...one, id: 'second-thread', body: 'Second thread comment' }
  snapshot.threads = [one, two]
  const texts = await Promise.all([one, two].map(thread => panel.fix({ url: REF.url, kind: 'thread', itemID: thread.id })))
  assert.ok(texts[0].includes(one.body))
  assert.ok(!texts[0].includes(two.body))
  assert.ok(texts[1].includes(two.body))
})

test('action requires a single-use token bound to the reviewed head', async () => {
  const { panel, calls } = fake()
  await panel.command(REF.url)
  await assert.rejects(panel.action('invented'), /expired/)
  const prepared = await panel.prepare('merge', REF.url)
  assert.ok(!calls.some(argv => argv[2] === 'merge'))
  await panel.action(prepared.token)
  const merge = calls.find(argv => argv[1] === 'pr' && argv[2] === 'merge')!
  assert.ok(merge.includes('--match-head-commit'))
  await assert.rejects(panel.action(prepared.token), /expired/)
})

test('head movement invalidates a confirmed action', async () => {
  const f = fake()
  await f.panel.command(REF.url)
  const prepared = await f.panel.prepare('merge', REF.url)
  f.setView({ ...f.view(), headRefOid: 'new-head' })
  await assert.rejects(f.panel.action(prepared.token), /PR changed/)
  assert.ok(!f.calls.some(argv => argv[1] === 'pr' && argv[2] === 'merge'))
  assert.equal(f.panel.state.busy, null)
})

test('mergeability changes invalidate auto-merge before it could merge immediately', async () => {
  const f = fake()
  f.setView({ ...f.view(), mergeStateStatus: 'BLOCKED' })
  await f.panel.command(REF.url)
  const prepared = await f.panel.prepare('auto-enable', REF.url)
  f.setView({ ...f.view(), mergeStateStatus: 'CLEAN' })
  await assert.rejects(f.panel.action(prepared.token), /PR changed/)
  assert.ok(!f.calls.some(argv => argv[1] === 'pr' && argv[2] === 'merge'))
})

test('invalid selections, unavailable methods and actions are rejected', async () => {
  const { panel } = fake()
  await assert.rejects(panel.select(REF.url), /no longer tracked/)
  await assert.rejects(panel.method(REF.url, 'squash'), /no longer tracked/)
  await panel.command(REF.url)
  await assert.rejects(panel.prepare('ready', REF.url), /no longer available/)
})

test('restored state clears busy flags and retains the agent toggle', () => {
  const f = fake()
  const saved: PanelState = { ...f.panel.state, busy: 'stale action', agent: false }
  const panel = createPanel({ run: f.panel.io.run, changed: () => {}, notify: async () => {}, tellAgent: async () => {} }, saved)
  assert.equal(panel.state.busy, null)
  assert.equal(panel.state.agent, false)
})

test('untrack, method, refresh and action preparation use explicit PR URLs', async () => {
  const f = fake()
  const otherURL = 'https://github.com/acme/app/pull/43'
  await f.panel.command(REF.url)
  await f.panel.command(otherURL)
  await f.panel.method(REF.url, 'rebase')
  assert.equal(f.panel.state.methods[REF.url], 'rebase')
  assert.equal(f.panel.state.methods[otherURL], undefined)
  const prepared = await f.panel.prepare('merge', REF.url, 'squash')
  assert.equal(prepared.url, REF.url)
  assert.match(prepared.label, /#42/)
  assert.match(prepared.label, /Squash/)
  assert.equal(await f.panel.command('untrack'), 'No PR is selected.')
  assert.equal(f.panel.state.prs.length, 2)
  await f.panel.command('untrack', REF.url)
  assert.equal(f.panel.selected()!.ref.url, otherURL)
  await assert.rejects(f.panel.refresh(REF.url), /no longer tracked/)
  assert.equal(f.panel.state.prs.length, 1)
})

test('a second client preparing an action cannot invalidate an existing token', async () => {
  const f = fake()
  await f.panel.command(REF.url)
  const first = await f.panel.prepare('merge', REF.url)
  const second = await f.panel.prepare('merge', REF.url)
  assert.notEqual(first.token, second.token)
  f.panel.state.busy = 'another action'
  await assert.rejects(f.panel.action(first.token), /already running/)
  f.panel.state.busy = null
  await f.panel.action(first.token)
  await assert.rejects(f.panel.action(first.token), /expired/)
})

test('confirmation waits for an in-progress refresh without consuming the token', async () => {
  const f = fake()
  await f.panel.command(REF.url)
  const prepared = await f.panel.prepare('merge', REF.url)
  const run = f.panel.io.run
  let enter!: () => void, release!: () => void
  const entered = new Promise<void>(resolve => { enter = resolve })
  const wait = new Promise<void>(resolve => { release = resolve })
  let blocked = false
  f.panel.io.run = async (argv, timeout) => {
    if (!blocked && argv.includes('-i')) { blocked = true; enter(); await wait }
    return run(argv, timeout)
  }
  const polling = f.panel.refresh(REF.url)
  await entered
  const action = f.panel.action(prepared.token)
  assert.ok(!f.calls.some(argv => argv[2] === 'merge'))
  release()
  await Promise.all([polling, action])
  assert.equal(f.calls.filter(argv => argv[2] === 'merge').length, 1)
})
