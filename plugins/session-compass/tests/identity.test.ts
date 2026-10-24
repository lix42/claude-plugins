import { describe, expect, test } from 'claude-code/testing'

import { MAX_REMEMBERED, PALETTE, paletteAfter, paletteAt, parseColor, parseName, placeLine, rememberColor } from '../hooks/identity'
import { cleanSummary } from '../hooks/summarize'

describe('name', () => {
  test('a name the person gave wins over the generated title, the newest of each', () => {
    const lines = [
      '"aiTitle":"First guess"',
      '"agentName":"PR panel"',
      '"aiTitle":"Later guess"',
      '"customTitle":"Release \\"v2\\""',
    ].join('\n')
    expect(parseName(lines)).toBe('Release "v2"')
  })

  test('the generated title stands in when there is no given name', () => {
    expect(parseName('"aiTitle":"Claude mod UI scope"\n')).toBe('Claude mod UI scope')
    expect(parseName('')).toBeNull()
  })
})

describe('color', () => {
  test('names and hex colors are read; anything else is not', () => {
    expect(parseColor('Blue')).toBe('#3b82f6')
    expect(parseColor('#ABC')).toBe('#abc')
    expect(parseColor('#12345')).toBeNull()
    expect(parseColor('mauve')).toBeNull()
    expect(parseColor('constructor')).toBeNull()
    expect(parseColor('__proto__')).toBeNull()
  })

  test('the next color is the one after the session\'s own', () => {
    expect(paletteAfter(PALETTE[0])).toBe(PALETTE[1])
    expect(paletteAfter(PALETTE.at(-1)!)).toBe(PALETTE[0])
    expect(paletteAfter('#123456')).toBe(PALETTE[0])
  })

  test('the palette wraps around', () => {
    expect(paletteAt(PALETTE.length + 1)).toBe(PALETTE[1])
    expect(paletteAt(-1)).toBe(PALETTE[PALETTE.length - 1])
  })

  test('remembered colors keep the newest sessions', () => {
    let colors: Record<string, string> = {}
    for (let i = 0; i <= MAX_REMEMBERED; i++) colors = rememberColor(colors, `s${i}`, '#fff')
    expect(Object.keys(colors)).toHaveLength(MAX_REMEMBERED)
    expect(colors.s0).toBeUndefined()
    colors = rememberColor(colors, 's1', '#000')
    expect(Object.keys(colors).at(-1)).toBe('s1')
  })
})

test('placeLine prefers the repo name and adds the branch', () => {
  expect(placeLine('/src/app', 'acme/app', 'main')).toBe('acme/app · main')
  expect(placeLine('/src/app/', null, null)).toBe('app')
})

test('cleanSummary keeps one plain line, in the speaker\'s own voice', () => {
  expect(cleanSummary('Summary: **Fixed** the\n build.')).toBe('Fixed the build.')
  expect(cleanSummary('"Quoted."')).toBe('Quoted.')
  expect(cleanSummary('  ')).toBeNull()
  expect(cleanSummary('The assistant reversed the pane.')).toBe('I reversed the pane.')
  expect(cleanSummary('The user asked to put the newest entry at the bottom.')).toBe('Put the newest entry at the bottom.')
})
