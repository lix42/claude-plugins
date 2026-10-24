/** Accent colors handed out to sessions in turn, picked to stay apart on dark and light themes. */
export const PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#ef4444', '#84cc16'] as const

const NAMED: Record<string, string> = {
  blue: '#3b82f6',
  green: '#10b981',
  amber: '#f59e0b',
  orange: '#f97316',
  pink: '#ec4899',
  violet: '#8b5cf6',
  purple: '#8b5cf6',
  cyan: '#06b6d4',
  red: '#ef4444',
  lime: '#84cc16',
  yellow: '#eab308',
  teal: '#14b8a6',
}

export const COLOR_NAMES = Object.keys(NAMED)

/** The picker's swatches: each named color once (purple is violet's alias). */
export const SWATCHES = Object.entries(NAMED).filter(([colorName]) => colorName !== 'purple')

/** Reads `/compass color <arg>`: a palette name or a hex color, else null. */
export const parseColor = (arg: string): string | null => {
  const value = arg.trim().toLowerCase()
  // Own keys only: `constructor` or `__proto__` is no color.
  if (Object.hasOwn(NAMED, value)) return NAMED[value]!
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(value) ? value : null
}

/** The palette color after `color`; the first when `color` is not one of the palette's. */
export const paletteAfter = (color: string) => paletteAt((PALETTE as readonly string[]).indexOf(color.toLowerCase()) + 1)

/** The palette color after `index` (the store's counter), wrapping around. */
export const paletteAt = (index: number) => PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length]!

/** Sessions whose colors the store keeps; the oldest leave past this. */
export const MAX_REMEMBERED = 200

export const rememberColor = (colors: Record<string, string>, sessionId: string, color: string) => {
  const { [sessionId]: _old, ...rest } = colors
  const entries = Object.entries({ ...rest, [sessionId]: color })
  return Object.fromEntries(entries.slice(-MAX_REMEMBERED))
}

const NAME_FIELD = /"(customTitle|agentName|aiTitle)":"((?:[^"\\]|\\.)*)"/

/**
 * The session's name from the title lines of its transcript, newest last: a
 * name the person gave (`/rename`) wins over the title Claude Code generated.
 */
export const parseName = (grepOutput: string): string | null => {
  let given: string | null = null
  let generated: string | null = null
  for (const line of grepOutput.split('\n')) {
    const match = NAME_FIELD.exec(line)
    if (!match?.[2]) continue
    let value: string
    try {
      value = JSON.parse(`"${match[2]}"`) as string
    } catch {
      continue
    }
    if (!value.trim()) continue
    if (match[1] === 'aiTitle') generated = value.trim()
    else given = value.trim()
  }
  return given ?? generated
}

/**
 * Finds the session's transcript and prints its title fields, one per line:
 * the newest of each field, in the order they were written, so a /rename made
 * long ago is not crowded out by later generated titles.
 */
export const nameCommand = (sessionId: string) => [
  'sh',
  '-c',
  'f=$(ls "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/projects/*/"$1".jsonl 2>/dev/null | head -n 1); ' +
    '[ -n "$f" ] && grep -o -E \'"(customTitle|agentName|aiTitle)":"([^"\\\\]|\\\\.)*"\' "$f" | ' +
    'awk -F\'"\' \'{ last[$2] = NR; line[NR] = $0 } END { for (k in last) print last[k] "\\t" line[last[k]] }\' | ' +
    'sort -n | cut -f 2-',
  'sh',
  sessionId,
]

const basename = (path: string) => path.replace(/\/+$/, '').split('/').pop() || path

/** Where the session runs: `repo · branch`, or the folder's name. */
export const placeLine = (root: string, repoName: string | null, branch: string | null) =>
  [repoName ?? basename(root), branch].filter(Boolean).join(' · ')
