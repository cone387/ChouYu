import { describe, expect, it } from 'vitest'
import { matchesSearchShortcut, normalizeSearchShortcut } from './search-shortcut'
import { normalizeConfig, sanitizeConfigPatch } from './config'

describe('search shortcuts', () => {
  const event = { key: 'k', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, isComposing: false, repeat: false }
  it('normalizes aliases and allows disabling', () => {
    expect(normalizeSearchShortcut('shift+ctrl+k')).toBe('Control+Shift+K')
    expect(normalizeSearchShortcut(' ')).toBe('')
    for (const invalid of ['K', 'Shift+K', 'Control+Control+K', 'Ctrl+V', 'Control+Shift+A', 'Alt+Space']) expect(() => normalizeSearchShortcut(invalid)).toThrow()
  })
  it('matches exact modifiers on each platform and ignores composition and repeats', () => {
    expect(matchesSearchShortcut(event, 'CommandOrControl+K', false)).toBe(true)
    expect(matchesSearchShortcut(event, 'CommandOrControl+K', true)).toBe(false)
    expect(matchesSearchShortcut({ ...event, ctrlKey: false, metaKey: true }, 'CommandOrControl+K', true)).toBe(true)
    for (const change of [{ shiftKey: true }, { altKey: true }, { isComposing: true }, { repeat: true }]) expect(matchesSearchShortcut({ ...event, ...change }, 'Control+K', false)).toBe(false)
    expect(matchesSearchShortcut(event, '', false)).toBe(false)
  })
  it('migrates old config, preserves disabling and validates saved values', () => {
    expect(normalizeConfig({}).searchHotkey).toBe('CommandOrControl+K')
    expect(normalizeConfig({ searchHotkey: '' }).searchHotkey).toBe('')
    expect(sanitizeConfigPatch({ searchHotkey: 'alt+k' }).searchHotkey).toBe('Alt+K')
    expect(() => sanitizeConfigPatch({ searchHotkey: 'K' })).toThrow()
  })
})
