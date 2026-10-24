export const SUMMARY_MODEL = 'haiku'
/** The longest text sent for a summary; past it the head is enough to say what it was. */
const MAX_INPUT = 6_000

const SYSTEM =
  'You condense items of a coding session history into one line each, so the person sees at a glance what happened. ' +
  'Reply with one plain sentence of at most 20 words: no preamble, no quotes, no markdown. ' +
  'Never name the speaker in the third person: no "The assistant", "The user", "The person".'

const VOICE = {
  prompt:
    'This message is what the person wrote. Restate it in their own voice, as a shorter version of the request ' +
    '(for example "Put the newest entries at the bottom of the pane."):\n\n',
  response:
    'This reply is what you, the assistant, wrote. Say what you did or concluded, in the first person ' +
    '(for example "I reversed the pane so the newest entry sits at the bottom, but left auto-scroll untested."):\n\n',
}

export const summaryPrompt = (kind: 'prompt' | 'response', text: string) => ({
  system: SYSTEM,
  prompt: VOICE[kind] + text.slice(0, MAX_INPUT),
})

// What a reply still opens with now and then, despite the instruction.
const THIRD_PERSON = /^the (assistant|ai|agent|model)\s+/i
const ASKED = /^the (user|person) (asks|asked|wants|wanted|requests|requested)( you)?( to)?\s+/i

/** The model's reply as one clean line, or null when it gave nothing usable. */
export const cleanSummary = (reply: string): string | null => {
  const line = reply
    .replace(/^\s*(summary|sentence)\s*:\s*/i, '')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .replace(THIRD_PERSON, 'I ')
    .replace(ASKED, '')
  return line ? line.charAt(0).toUpperCase() + line.slice(1) : null
}
