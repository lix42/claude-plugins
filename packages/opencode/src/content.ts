import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import type { Options } from './options.ts'

export const root = fileURLToPath(new URL('../../../', import.meta.url))
export const asset = (path: string) => `${root}${path}`

export function markdown(text: string): { meta: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)
  return match
    ? { meta: parse(match[1]) ?? {}, body: text.slice(match[0].length).trim() }
    : { meta: {}, body: text.trim() }
}

export async function skills(config: Options) {
  const result = []
  for (const plugin of ['tasks', 'ship'] as const) {
    if (!config[plugin]) continue
    const dir = asset(`plugins/${plugin}/skills`)
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const path = `${dir}/${entry.name}/SKILL.md`
      const { meta, body } = markdown(await readFile(path, 'utf8'))
      result.push({
        id: entry.name,
        name: String(meta.name ?? entry.name),
        description: String(meta.description ?? ''),
        path,
        content: body,
        autoinvoke: meta['disable-model-invocation'] !== true,
      })
    }
  }
  return result
}

export async function agents() {
  const dir = asset('plugins/ship/agents')
  const contract = await readFile(asset('plugins/ship/skills/review-changes/reviewer-contract.md'), 'utf8')
  return Promise.all((await readdir(dir)).filter(name => name.endsWith('.md')).map(async name => {
    const { meta, body } = markdown(await readFile(`${dir}/${name}`, 'utf8'))
    const system = name.startsWith('review-')
      ? `${body}\n\n## OpenCode: embedded reviewer contract\n\nThe contract below is already loaded in your system instructions. Follow it instead of reading a packaged reviewer-contract.md outside the project, even if the brief includes that path.\n\n${contract}`
      : body
    return { id: `ship/${name.slice(0, -3)}`, name: name.slice(0, -3), description: String(meta.description ?? ''), system }
  }))
}
