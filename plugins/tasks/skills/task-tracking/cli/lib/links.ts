// Relative markdown links between docs files. Paths are posix and relative to the docs dir.

export function normalize(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..' && out.length > 0 && out[out.length - 1] !== '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

export function dirOf(path: string): string {
  const at = path.lastIndexOf('/')
  return at < 0 ? '' : path.slice(0, at)
}

export function resolveFrom(dir: string, target: string): string {
  return normalize(dir === '' ? target : `${dir}/${target}`)
}

export function relativeTo(fromDir: string, to: string): string {
  const from = fromDir === '' ? [] : fromDir.split('/')
  const dest = to.split('/')
  let i = 0
  while (i < from.length && i < dest.length - 1 && from[i] === dest[i]) i++
  return [...from.slice(i).map(() => '..'), ...dest.slice(i)].join('/')
}

// Inline `](target)`, reference definitions `[x]: target`, and HTML `href="target"`.
const LINK = /(\]\()([^)\s]+)(\))|^(\s{0,3}\[[^\]^][^\]]*\]:\s*)(\S+)()|(href=")([^"]+)(")/gm

/** A relative link to a file: not a URL, absolute path or anchor, and path-like (`a/b`, `x.md`). */
function isRelative(target: string): boolean {
  if (/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(target)) return false
  const bare = target.split('#')[0]!
  return bare.includes('/') || /\.[a-z0-9]+$/i.test(bare)
}

/** Apply `fn` to the text outside fenced code blocks. */
function outsideFences(text: string, fn: (chunk: string) => string): string {
  return text
    .split(/(^[ \t]*(?:```|~~~)[^\n]*\n[\s\S]*?^[ \t]*(?:```|~~~)[^\n]*$)/m)
    .map((part, i) => (i % 2 === 1 ? part : fn(part)))
    .join('')
}

function targets(text: string): string[] {
  const out: string[] = []
  outsideFences(text, chunk => {
    for (const m of chunk.matchAll(LINK)) out.push(m[2] ?? m[5] ?? m[8]!)
    return chunk
  })
  return out
}

/** Every relative link in `text`, resolved to a docs-relative path (anchor dropped). */
export function linkedPaths(text: string, fileDir: string): string[] {
  return targets(text)
    .filter(isRelative)
    .map(t => resolveFrom(fileDir, t.split('#')[0]!))
}

/**
 * Rewrite relative links in a file that moves from `oldDir` to `newDir` (they may be equal),
 * redirecting links to any path in `moves` (old docs-relative path → new).
 */
export function rewriteLinks(text: string, oldDir: string, newDir: string, moves: ReadonlyMap<string, string>): string {
  return outsideFences(text, chunk => chunk.replace(LINK, (whole, ...g: (string | undefined)[]) => {
    const [pre, target, post] = g[0] !== undefined ? [g[0], g[1]!, g[2]!] : g[3] !== undefined ? [g[3], g[4]!, g[5]!] : [g[6]!, g[7]!, g[8]!]
    if (!isRelative(target)) return whole
    const hash = target.indexOf('#')
    const bare = hash < 0 ? target : target.slice(0, hash)
    const anchor = hash < 0 ? '' : target.slice(hash)
    if (bare === '') return whole
    const resolved = resolveFrom(oldDir, bare)
    const moved = moves.get(resolved)
    if (moved === undefined && oldDir === newDir) return whole
    return `${pre}${relativeTo(newDir, moved ?? resolved)}${anchor}${post}`
  }))
}

/**
 * Task ids a body's `## Dependencies` section names, by relative link or as a bold `**id**`;
 * null when it has no such section. Callers filter to ids that exist.
 */
export function dependencySectionIds(id: string, body: string): string[] | null {
  const sec = /^## Dependencies[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(body)
  if (!sec) return null
  const out: string[] = []
  const add = (dep: string): void => {
    if (dep !== id && !out.includes(dep)) out.push(dep)
  }
  for (const p of linkedPaths(sec[1]!, dirOf(`tasks/${id}.md`))) {
    const m = /^tasks\/(.+)\.md$/.exec(p)
    if (m) add(m[1]!)
  }
  for (const m of sec[1]!.matchAll(/\*\*([a-z0-9][a-z0-9/-]*)\*\*/g)) add(m[1]!)
  return out
}
