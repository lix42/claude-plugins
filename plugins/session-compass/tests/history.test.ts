import { describe, expect, test } from 'claude-code/testing'

import {
  addPrompt,
  displayText,
  finishResponse,
  fromMessages,
  hashText,
  isMetaText,
  parseCommandText,
  pendingSummaries,
  promptLine,
  recordTool,
  settleLive,
  startResponse,
  type MessageRow,
} from '../hooks/history'
import type { Entry, PromptEntry } from '../types'

const LONG = 'Investigated the failing check. '.repeat(8)

const prompt = (id: string, text: string): PromptEntry => ({ kind: 'prompt', id, at: 0, text, command: null })

describe('live capture', () => {
  test('a turn collects its tools, skills and agents, then its answer', () => {
    let list: Entry[] = addPrompt([], prompt('p1', 'fix the build'))
    list = startResponse(list, 'r1', 0)
    list = recordTool(list, 'Bash', {})
    list = recordTool(list, 'Bash', {})
    list = recordTool(list, 'Skill', { skill: 'code-review' })
    list = recordTool(list, 'Skill', { skill: 'code-review' })
    list = recordTool(list, 'Agent', { subagent_type: 'Explore' })
    list = finishResponse(list, '  Fixed it.  ', 12_000)

    expect(list[1]).toEqual({
      kind: 'response',
      id: 'r1',
      at: 0,
      text: 'Fixed it.',
      tools: { Bash: 2, Skill: 2, Agent: 1 },
      skills: ['code-review'],
      agents: ['Explore'],
      durationMs: 12_000,
      isLive: false,
    })
  })

  test('a tool call with no running response changes nothing', () => {
    const list = addPrompt([], prompt('p1', 'hi'))
    expect(recordTool(list, 'Bash', {})).toBe(list)
  })

  test('settleLive ends a response left running', () => {
    const list = settleLive(startResponse([], 'r1', 0))
    expect(list[0]).toMatchObject({ isLive: false })
  })
})

describe('transcript rows', () => {
  test('meta rows are not prompts', () => {
    expect(isMetaText('<local-command-caveat>Caveat: …')).toBe(true)
    expect(isMetaText('Base directory for this skill: /x')).toBe(true)
    expect(isMetaText('   ')).toBe(true)
    expect(isMetaText('fix the build')).toBe(false)
  })

  test('a slash command row reads as the command', () => {
    expect(
      parseCommandText('<command-name>/code-review</command-name>\n <command-message>code-review</command-message>\n <command-args>high</command-args>'),
    ).toEqual({ name: 'code-review', args: 'high' })
    expect(parseCommandText('just text')).toBeNull()
  })

  test('fromMessages pairs each prompt with the response after it', () => {
    const rows: MessageRow[] = [
      { role: 'user', text: 'fix the build', toolUses: [] },
      { role: 'assistant', text: 'Looking.', toolUses: [{ tool: 'Bash', input: { command: 'npm test' } }] },
      { role: 'user', text: '', toolUses: [], toolResults: [{}] },
      { role: 'assistant', text: 'Fixed.', toolUses: [{ tool: 'Skill', input: { skill: 'ship' } }] },
      { role: 'user', text: '<local-command-caveat>Caveat</local-command-caveat>', toolUses: [] },
      { role: 'user', text: '<command-name>/recap</command-name><command-args></command-args>', toolUses: [] },
      // A local command's output row follows it, so the next prompt is no expansion of it.
      { role: 'user', text: '<local-command-stdout>Recap…</local-command-stdout>', toolUses: [] },
      { role: 'user', text: 'thanks', toolUses: [] },
    ]
    const list = fromMessages(rows)
    expect(list.map(entry => entry.kind)).toEqual(['prompt', 'response', 'prompt', 'prompt'])
    expect(list[1]).toMatchObject({ text: 'Fixed.', tools: { Bash: 1, Skill: 1 }, skills: ['ship'], isLive: false })
    expect(list[2]).toMatchObject({ kind: 'prompt', command: { name: 'recap', args: '' }, text: '' })
    expect(list[3]).toMatchObject({ kind: 'prompt', text: 'thanks', at: 0 })
  })

  test('a command row may open with its message, and its expansion is no prompt', () => {
    const rows: MessageRow[] = [
      {
        role: 'user',
        text: '<command-message>code-review is running…</command-message>\n<command-name>/code-review</command-name>\n<command-args>high</command-args>',
        toolUses: [],
      },
      { role: 'user', text: '# Review\nReview the diff for bugs.', toolUses: [] },
      { role: 'assistant', text: 'No findings.', toolUses: [] },
      { role: 'user', text: 'This session is being continued from a previous conversation that ran out of context.', toolUses: [] },
      { role: 'user', text: 'pasted <command-name>/x</command-name> in a prompt', toolUses: [] },
    ]
    const list = fromMessages(rows)
    expect(list.map(entry => entry.kind)).toEqual(['prompt', 'response', 'prompt'])
    expect(list[0]).toMatchObject({ command: { name: 'code-review', args: 'high' } })
    expect(list[2]).toMatchObject({ command: null, text: 'pasted <command-name>/x</command-name> in a prompt' })
  })
})

describe('summaries', () => {
  test('only finished long texts not asked for yet are pending, newest first', () => {
    const list: Entry[] = [
      prompt('p1', LONG),
      prompt('p2', 'short'),
      { ...prompt('p3', `${LONG} again`) },
      { kind: 'response', id: 'r1', at: 0, text: LONG + 'live', tools: {}, skills: [], agents: [], durationMs: null, isLive: true },
    ]
    const pending = pendingSummaries(list, {}, new Set())
    expect(pending.map(item => item.text)).toEqual([`${LONG} again`, LONG])
    expect(pendingSummaries(list, { [hashText(LONG)]: 'x' }, new Set([hashText(`${LONG} again`)]))).toEqual([])
  })

  test('a three-line text counts as long; blank lines do not count', () => {
    expect(pendingSummaries([prompt('p1', 'a\nb\nc')], {}, new Set())).toHaveLength(1)
    expect(pendingSummaries([prompt('p2', 'a\n \nb')], {}, new Set())).toHaveLength(0)
  })

  test('displayText shows the summary, else the first lines cut short', () => {
    const entry = prompt('p1', LONG)
    expect(displayText(entry, { [hashText(LONG)]: 'Checked the failure.' })).toEqual({ text: 'Checked the failure.', isSummary: true })
    expect(displayText(entry, {}).text.endsWith(' …')).toBe(true)
    expect(displayText(prompt('p2', 'one\n\ntwo'), {})).toEqual({ text: 'one two', isSummary: false })
  })

  test('promptLine puts a command back as typed', () => {
    expect(promptLine({ ...prompt('p1', ''), command: { name: 'code-review', args: 'high' } })).toBe('/code-review high')
    expect(promptLine(prompt('p2', 'fix it'))).toBe('fix it')
  })
})
