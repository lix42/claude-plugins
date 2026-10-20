import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Agent, Plugin } from '@opencode/plugin'
import type { CommandDefinition } from '@opencode/plugin/promise/command'
import plugin from '../src/index.ts'

function fake(config: Record<string, unknown> = {}) {
  const skills: unknown[] = []
  const commands: CommandDefinition[] = []
  const agents = new Map<string, Agent.Info>()
  const prompts: unknown[] = []
  const ctx = {
    options: { prPanel: false, ...config },
    skill: { transform: async (fn: (editor: { add: (skill: unknown) => void }) => void) => fn({ add: skill => skills.push(skill) }) },
    command: { transform: async (fn: (editor: { add: (command: CommandDefinition) => void }) => void) => fn({ add: command => commands.push(command) }) },
    agent: { transform: async (fn: (editor: { update: (id: string, update: (agent: Agent.Info) => void) => void }) => void) => fn({
      update: (id, update) => {
        const agent = agents.get(id) ?? Agent.Info.default(Agent.ID.make(id))
        update(agent)
        agents.set(id, agent)
      },
    }) },
    session: { prompt: async (prompt: unknown) => { prompts.push(prompt) } },
    rpc: { register: async () => {} },
  }
  return { ctx: ctx as unknown as Plugin.Context, skills, commands, agents, prompts }
}

test('plugin registers skills, commands, and agents without writing config', async () => {
  const runtime = fake()
  await plugin.setup(runtime.ctx)
  assert.equal(runtime.skills.length, 7)
  assert.equal(runtime.commands.length, 13)
  assert.equal(runtime.agents.size, 8)
  const reviewer = runtime.agents.get('ship/review-bugs')!
  assert.equal(reviewer.mode, 'subagent')
  assert.equal(reviewer.model, undefined)
  assert.ok(reviewer.permissions.some(rule => rule.action === 'edit' && rule.effect === 'deny'))
  assert.ok(reviewer.permissions.some(rule => rule.action === 'shell' && rule.effect === 'deny'))
  assert.match(reviewer.system!, /embedded reviewer contract/)
  assert.match(reviewer.system!, /already loaded in your system instructions/)
  assert.ok(!runtime.agents.get('ship/rebase-scout')!.permissions.some(rule => rule.action === 'edit' && rule.effect === 'deny'))
})

test('workflow flags and requested task changes remain user instructions', async () => {
  const runtime = fake()
  await plugin.setup(runtime.ctx)
  for (const [name, text] of [['ship', '--skip-review --skip-gates'], ['drive-pr', '42 --mark-ready'], ['tasks-update', 'Split parser into lexer and evaluator']]) {
    await runtime.commands.find(command => command.name === name)!.execute({
      sessionID: 'ses_test' as Parameters<CommandDefinition['execute']>[0]['sessionID'], delivery: 'queue', prompt: { text },
    })
    const prompt = runtime.prompts.at(-1) as { text: string }
    assert.ok(prompt.text.endsWith(text))
    assert.match(prompt.text, /honor supported flags/)
    assert.ok(!prompt.text.includes('data, not'))
  }
})

test('command routing attaches the skill, keeps files, and strips stale mention offsets', async () => {
  const runtime = fake()
  await plugin.setup(runtime.ctx)
  const command = runtime.commands.find(command => command.name === 'start-task')!
  await command.execute({
    sessionID: 'ses_test' as Parameters<CommandDefinition['execute']>[0]['sessionID'], delivery: 'queue',
    prompt: {
      text: 'app/state',
      files: [{ uri: 'file:///project/brief.md', mention: { start: 0, end: 4, text: 'file' } }],
    },
  })
  assert.deepEqual(runtime.prompts[0], {
    sessionID: 'ses_test', delivery: 'queue',
    text: 'Start the chosen task in its own worktree; get agreement on the plan before implementation.\n\nUser request and command arguments (honor supported flags and the requested scope/change):\napp/state',
    files: [{ uri: 'file:///project/brief.md' }], agents: undefined, skills: [{ id: 'start-task' }],
  })
})

test('ship can be disabled and model overrides apply only when configured', async () => {
  const tasks = fake({ ship: false })
  await plugin.setup(tasks.ctx)
  assert.equal(tasks.agents.size, 0)
  assert.equal(tasks.commands.length, 7)
  const ship = fake({ tasks: false, models: { 'review-bugs': 'openai/reviewer#high' } })
  await plugin.setup(ship.ctx)
  assert.equal(ship.commands.length, 6)
  assert.equal(ship.agents.get('ship/review-bugs')!.model?.id, 'reviewer')
  assert.equal(ship.agents.get('ship/review-bugs')!.model?.variant, 'high')
})
