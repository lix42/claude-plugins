import { expect, test } from 'claude-code/testing'

import { byPlugin, isOnExtraUsage, repoName, rowsOf, togglePin, withCommand } from '../hooks/model'

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
