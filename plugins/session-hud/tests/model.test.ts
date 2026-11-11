import { expect, test } from 'claude-code/testing'

import { byPlugin, readActivity, splitBySession, isOnExtraUsage, repoName, rowsOf, togglePin, withCommand } from '../hooks/model'

test('the repo is named from the engine, else the origin remote, else the folder', () => {
  const at = (remote: string | null, name: string | null = null) => repoName({ root: '/src/app', remote, name })
  expect(at('https://github.com/lix42/claude-plugins.git')).toBe('lix42/claude-plugins')
  expect(at('git@github.com:lix42/claude-plugins.git')).toBe('lix42/claude-plugins')
  expect(at('ssh://git@github.com/lix42/claude-plugins')).toBe('lix42/claude-plugins')
  expect(at('https://gitlab.com/group/sub/proj.git/')).toBe('group/sub/proj')
  expect(at(null)).toBe('app')
  expect(at('https://github.com/x/y.git', 'acme/app')).toBe('acme/app')
})

test('a pressed command leads the draft, replacing a command the draft began with', () => {
  expect(withCommand('deploy', '')).toBe('/deploy ')
  expect(withCommand('deploy', 'to staging')).toBe('/deploy to staging')
  expect(withCommand('deploy', '/ship to staging')).toBe('/deploy to staging')
})

test('extra usage: a plan window at or past its limit, or a spend limit', () => {
  expect(isOnExtraUsage([])).toBe(false)
  expect(isOnExtraUsage([{ kind: 'five_hour', percentUsed: 92 }, { kind: 'seven_day', percentUsed: 40 }])).toBe(false)
  expect(isOnExtraUsage([{ kind: 'five_hour', percentUsed: 100 }])).toBe(true)
  expect(isOnExtraUsage([{ kind: 'spend_limit', percentUsed: 3 }])).toBe(true)
})

test('pins toggle in and out, and list in the order pinned, skipping commands not here', () => {
  expect(togglePin(['a'], 'b')).toEqual(['a', 'b'])
  expect(togglePin(['a', 'b'], 'a')).toEqual(['b'])
  const rows = [
    { name: 'a', description: '', scope: 'user' as const },
    { name: 'b', description: '', scope: 'project' as const },
  ]
  expect(rowsOf('pinned', rows, ['b', 'gone', 'a']).map(row => row.name)).toEqual(['b', 'a'])
  expect(rowsOf('user', rows, []).map(row => row.name)).toEqual(['a'])
})

test('plugin commands split by plugin, sorted by name, an unknown plugin under other', () => {
  const row = (name: string, plugin?: string) => ({ name, description: '', scope: 'plugin' as const, ...(plugin ? { plugin } : {}) })
  const groups = byPlugin([row('ship:ship', 'ship'), row('tasks:next', 'tasks'), row('loose'), row('ship:rebase', 'ship')])
  expect(groups.map(([name, rows]) => [name, rows.map(one => one.name)])).toEqual([
    ['other', ['loose']],
    ['ship', ['ship:ship', 'ship:rebase']],
    ['tasks', ['tasks:next']],
  ])
})

test('what a session does is read from the end of its transcript', () => {
  const at = (ms: number) => new Date(ms).toISOString()
  const line = (record: object) => JSON.stringify(record)
  const finished = [
    line({ message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/a/b.ts' } }] }, timestamp: at(1_000) }),
    line({ type: 'system', subtype: 'turn_duration', timestamp: at(2_000) }),
    line({ type: 'last-prompt', lastPrompt: 'run   the\ntests' }),
  ]
  expect(readActivity(finished)).toEqual({ prompt: 'run the tests', tool: null, toolDetail: '', turnStartedAt: null, lastAt: 2_000 })
  const working = [
    ...finished,
    line({ message: { role: 'assistant', content: [{ type: 'text', text: 'On it.' }] }, timestamp: at(3_000) }),
    line({ message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test', description: 'Run the tests' } }] }, timestamp: at(4_000) }),
    // A subagent's step is not the session's own; a line cut short is skipped.
    line({ isSidechain: true, message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Grep', input: {} }] }, timestamp: at(5_000) }),
    '{"message":{"role":"assis',
  ]
  expect(readActivity(working)).toEqual({ prompt: 'run the tests', tool: 'Bash', toolDetail: 'Run the tests', turnStartedAt: 3_000, lastAt: 4_000 })
  // A long turn whose start is before the records: its tool shows, its start stays unknown.
  const midTurn = working.slice(3)
  expect(readActivity(midTurn)).toMatchObject({ tool: 'Bash', turnStartedAt: null, lastAt: 4_000 })
})

test('the activity output is split by the session heading each part', () => {
  expect(splitBySession('@@@ a\nx\ny\n@@@ b\n\n@@@ c\nz\n')).toEqual({ a: ['x', 'y'], b: [], c: ['z'] })
})
