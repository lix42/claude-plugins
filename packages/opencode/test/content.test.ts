import { test } from 'node:test'
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { agents, asset, markdown, skills } from '../src/content.ts'
import { commands, commandText } from '../src/commands.ts'
import { options } from '../src/options.ts'

test('all seven skills load with their own supporting files', async () => {
  const bundled = await skills(options({}))
  assert.deepEqual(bundled.map(skill => skill.id).sort(), ['drive-pr', 'rebase', 'review-changes', 'review-fix-loop', 'ship', 'start-task', 'task-tracking'])
  assert.equal(bundled.find(skill => skill.id === 'start-task')?.autoinvoke, false)
  for (const skill of bundled) {
    assert.ok(skill.description)
    assert.ok(!skill.content.startsWith('---'))
    await access(skill.path)
  }
  await access(asset('plugins/tasks/skills/task-tracking/cli/tasks.ts'))
  for (const skill of ['rebase', 'review-changes']) {
    const file = bundled.find(item => item.id === skill)!.path
    await access(resolve(dirname(file), '../../agents/rebase-scout.md'))
  }
})

test('feature flags remove definitions without disabling other features', async () => {
  assert.deepEqual((await skills(options({ ship: false }))).map(skill => skill.id).sort(), ['start-task', 'task-tracking'])
  assert.deepEqual(await skills(options({ tasks: false, ship: false })), [])
  assert.equal((await agents()).length, 8)
})

test('frontmatter uses YAML folded descriptions and preserves the body', () => {
  assert.deepEqual(markdown('---\nname: test\ndescription: >-\n  One\n  sentence.\n---\n# Body\n'), {
    meta: { name: 'test', description: 'One sentence.' }, body: '# Body',
  })
})

test('commands have unique names and preserve arguments literally', () => {
  assert.equal(new Set(commands.map(item => item[0])).size, 13)
  const args = 'parser --skip-review $(touch should-not-exist)'
  assert.ok(commandText('Run the workflow.', args).endsWith(args))
})

test('options reject malformed feature flags and model selections', () => {
  assert.throws(() => options({ tasks: 'false' }))
  assert.throws(() => options({ models: { default: 'opus' } }))
  assert.throws(() => options({ models: [] }))
  assert.deepEqual(options({ models: { default: 'openai/model#high' } }).models, { default: 'openai/model#high' })
})

test('ship host and cache instructions include OpenCode without sharing caches', async () => {
  const config = await readFile(asset('plugins/ship/skills/ship/config.md'), 'utf8')
  assert.match(config, /OpenCode: `\.opencode\/ship\.local\.json`/)
  assert.match(config, /Schema version 9/)
  const review = await readFile(asset('plugins/ship/skills/review-changes/SKILL.md'), 'utf8')
  assert.match(review, /ship\/review-\*/)
  assert.match(review, /actual scoped diff/)
})
