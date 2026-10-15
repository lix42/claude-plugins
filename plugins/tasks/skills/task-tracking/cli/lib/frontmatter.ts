// A deliberately small subset of YAML frontmatter: `key: scalar` and `key: [a, b]`.
// Scalars needing quotes are JSON-quoted, which is also valid YAML.

export type FmValue = string | string[]

export type Split = {
  /** null when the text has no frontmatter block. */
  fields: [string, FmValue][] | null
  body: string
  errors: string[]
}

const OPEN = '---\n'

export function splitFrontmatter(text: string): Split {
  if (text.startsWith('---\r\n')) return { fields: null, body: text, errors: ['CRLF line endings: convert the file to LF'] }
  if (!text.startsWith(OPEN)) return { fields: null, body: text, errors: [] }
  const end = findClose(text)
  if (end < 0) return { fields: null, body: text, errors: ['frontmatter has no closing `---`'] }
  const block = text.slice(OPEN.length, Math.max(end, OPEN.length))
  const after = text.slice(end + '\n---'.length).replace(/^\n/, '')
  const fields: [string, FmValue][] = []
  const errors: string[] = []
  block.split('\n').forEach((line, i) => {
    if (line.trim() === '' || line.trimStart().startsWith('#')) return
    const m = /^([a-z_][a-z0-9_]*):(?:\s+(.*))?$/.exec(line)
    if (!m) {
      errors.push(`frontmatter line ${i + 2}: expected \`key: value\`, got \`${line}\``)
      return
    }
    try {
      fields.push([m[1]!, parseValue((m[2] ?? '').trim())])
    } catch (e) {
      errors.push(`frontmatter line ${i + 2}: ${(e as Error).message}`)
    }
  })
  return { fields, body: after, errors }
}

function findClose(text: string): number {
  const at = text.indexOf('\n---\n', OPEN.length - 1)
  if (at >= 0) return at
  return text.endsWith('\n---') ? text.length - '\n---'.length : -1
}

function parseValue(raw: string): FmValue {
  if (raw.startsWith('[')) {
    if (!raw.endsWith(']')) throw new Error(`unterminated list \`${raw}\``)
    const inner = raw.slice(1, -1).trim()
    return inner === '' ? [] : splitItems(inner).map(s => parseScalar(s.trim()))
  }
  return parseScalar(raw)
}

/** Split on commas outside double quotes. */
function splitItems(inner: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!
    if (ch === '\\' && quoted) {
      cur += ch + (inner[++i] ?? '')
      continue
    }
    if (ch === '"') quoted = !quoted
    if (ch === ',' && !quoted) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  return [...out, cur]
}

function parseScalar(raw: string): string {
  if (raw.startsWith('"')) return JSON.parse(raw) as string
  if (raw.startsWith("'")) {
    if (!raw.endsWith("'") || raw.length < 2) throw new Error(`unterminated quote \`${raw}\``)
    return raw.slice(1, -1).replaceAll("''", "'")
  }
  return raw
}

export function serializeFrontmatter(fields: [string, FmValue][]): string {
  const lines = fields.map(([k, v]) =>
    Array.isArray(v) ? `${k}: [${v.map(quoteItem).join(', ')}]` : `${k}: ${quoteScalar(v)}`,
  )
  return `---\n${lines.join('\n')}\n---\n`
}

const PLAIN_RESERVED = /^(true|false|yes|no|on|off|null|~|[-+]?[0-9][0-9_.:eE+-]*)$/i

function quoteScalar(v: string): string {
  const needs =
    v === '' ||
    v !== v.trim() ||
    /[\r\n\u2028\u2029]/.test(v) ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(v) ||
    /: |\s#|:$/.test(v) ||
    PLAIN_RESERVED.test(v) && !/^(\d+|\d{4}-\d{2}-\d{2})$/.test(v)
  return needs ? JSON.stringify(v) : v
}

function quoteItem(v: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(v) ? v : JSON.stringify(v)
}
