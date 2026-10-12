import type { Check, PrRef, Thread } from '../types'

export const LOG_TAIL_LINES = 150

/** The last `lines` lines of a log, so a prompt carries the failure and not the setup. */
export const tailLines = (text: string, lines = LOG_TAIL_LINES): string => {
  const all = text.trimEnd().split('\n')
  return all.length <= lines ? all.join('\n') : all.slice(-lines).join('\n')
}

export const fixCheckPrompt = (ref: PrRef, check: Check, log: string | null): string => {
  const name = check.workflow ? `${check.workflow} / ${check.name}` : check.name
  const head = `The CI check "${name}" failed on PR #${ref.number} (${ref.url}).`
  const where = check.url ? `\nDetails: ${check.url}` : ''
  const body = log
    ? `\n\nLast ${LOG_TAIL_LINES} lines of the failed log:\n\n\`\`\`\n${tailLines(log)}\n\`\`\``
    : '\n\nI could not fetch its log; look it up from the details link.'
  return `${head}${where}${body}\n\nFind the cause and fix it.`
}

export const fixThreadPrompt = (ref: PrRef, thread: Thread): string => {
  const where = thread.line ? `${thread.path}:${thread.line}` : thread.path
  const outdated = thread.isOutdated ? ' (on an outdated diff)' : ''
  return [
    `${thread.author} left an unresolved review comment on PR #${ref.number} at ${where}${outdated}:`,
    '',
    thread.body
      .split('\n')
      .map(line => `> ${line}`)
      .join('\n'),
    ...thread.replies.flatMap(reply => [
      '',
      `${reply.author} replied:`,
      reply.body
        .split('\n')
        .map(line => `> ${line}`)
        .join('\n'),
    ]),
    '',
    `Thread: ${thread.url}`,
    '',
    'Address this comment.',
  ].join('\n')
}
