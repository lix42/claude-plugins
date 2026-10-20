import { Agent, Model, Plugin, Skill } from '@opencode/plugin'
import { agents, skills } from './content.ts'
import { commands, commandText } from './commands.ts'
import { options } from './options.ts'
import { setupPanel } from './server.ts'

export default Plugin.define({
  id: 'lix42',
  async setup(ctx) {
    const config = options(ctx.options)
    const bundled = await skills(config)
    await ctx.skill.transform(editor => {
      for (const skill of bundled) editor.add({
        ...skill, id: Skill.ID.make(skill.id), name: Skill.Name.make(skill.name),
        path: skill.path as Skill.Info['path'], // fileURLToPath produces an absolute path.
      })
    })
    await ctx.command.transform(editor => {
      for (const [name, feature, skill, instruction] of commands) {
        if (!config[feature]) continue
        editor.add({
          name,
          description: instruction,
          execute: async ({ sessionID, prompt, delivery }) => {
            // Keep attachments, but remove offsets invalidated by the rewritten text.
            await ctx.session.prompt({
              ...prompt, sessionID, delivery,
              text: commandText(instruction, prompt.text),
              files: prompt.files?.map(({ mention, ...file }) => file),
              agents: prompt.agents?.map(({ mention, ...agent }) => agent),
              skills: [{ id: skill }, ...(prompt.skills ?? []).filter(item => item.id !== skill).map(({ mention, ...item }) => item)],
            })
          },
        })
      }
    })
    if (config.ship) {
      const reviewers = await agents()
      await ctx.agent.transform(editor => {
        for (const reviewer of reviewers) {
          // AgentEditor.update creates absent agents in OpenCode 2.0.32.
          editor.update(reviewer.id, agent => {
            agent.name = Agent.Name.make(reviewer.id)
            agent.mode = 'subagent'
            agent.description = reviewer.description
            agent.system = reviewer.system
            agent.hidden = false
            const model = config.models[reviewer.name] ?? config.models.default
            if (model) agent.model = Model.Ref.parse(model)
            if (reviewer.name.startsWith('review-')) {
              const readRules = agent.permissions.filter(rule => ['read', 'glob', 'grep', 'external_directory'].includes(rule.action))
              agent.permissions.push(
                { action: '*', resource: '*', effect: 'deny' },
                ...['read', 'glob', 'grep'].map(action => ({ action, resource: '*', effect: 'allow' as const })),
                { action: 'external_directory', resource: '*', effect: 'ask' },
                ...readRules,
                { action: 'edit', resource: '*', effect: 'deny' },
                { action: 'shell', resource: '*', effect: 'deny' },
              )
              agent.system += '\n\nIn OpenCode this reviewer cannot run shell commands. Ask the parent to include the actual diff in its brief, and use read/glob/grep for code and caller inspection. Never edit or run mutations.'
            }
          })
        }
      })
    }
    return setupPanel(ctx, undefined, { enabled: config.prPanel })
  },
})
