import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveTheme } from './theme'
import { searchSettings, SETTINGS_SEARCH_INDEX } from '../components/Settings/settings-search-index'

const stylesheet = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles/index.css'), 'utf8')
const settingsSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/Settings/Settings.tsx'), 'utf8')
const configSource = readFileSync(resolve(process.cwd(), 'src/shared/config.ts'), 'utf8')

function darkVarBlock(source: string, selector: string): string {
  const start = source.indexOf(selector)
  if (start < 0) return ''
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open, i + 1)
    }
  }
  return ''
}

describe('theme preference', () => {
  it('resolves system preference from the OS media query', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('lets manual light/dark override the OS setting', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('keeps theme in the persisted config pipeline', () => {
    expect(configSource).toContain("theme: 'system' | 'light' | 'dark'")
    expect(configSource).toContain("theme: 'system'")
    expect(configSource).toContain("source.theme === 'light' || source.theme === 'dark'")
    expect(configSource).toContain("input.theme === 'system' || input.theme === 'light' || input.theme === 'dark'")
  })

  it('applies dark variables for both media fallback and manual override', () => {
    expect(stylesheet).toContain("@media (prefers-color-scheme: dark)")
    expect(stylesheet).toContain(":root:not([data-theme='light'])")
    expect(stylesheet).toContain(":root[data-theme='dark']")
    const mediaBlock = darkVarBlock(stylesheet, ":root:not([data-theme='light'])")
    const manualBlock = darkVarBlock(stylesheet, ":root[data-theme='dark']")
    const countVars = (block: string) => (block.match(/--[a-z-]+:/g) || []).length
    expect(countVars(mediaBlock)).toBeGreaterThan(20)
    // The two dark blocks must stay in sync.
    expect(countVars(mediaBlock)).toBe(countVars(manualBlock))
  })
})

describe('settings field search', () => {
  it('matches fields by label, nav label and keywords', () => {
    expect(searchSettings('开机自启').some((entry) => entry.fieldId === 'settings-autostart')).toBe(true)
    expect(searchSettings('快捷键').some((entry) => entry.fieldId === 'settings-hotkey')).toBe(true)
    expect(searchSettings('mem0').some((entry) => entry.nav === 'memory')).toBe(true)
    expect(searchSettings('深色').some((entry) => entry.label === '外观主题')).toBe(true)
    expect(searchSettings('')).toEqual([])
    expect(searchSettings('不存在的设置项')).toEqual([])
  })

  it('keeps every indexed anchor pointing at a real nav pane', () => {
    const navKeys = new Set(['ai', 'tools', 'memory', 'capabilities', 'persona', 'general', 'about'])
    for (const entry of SETTINGS_SEARCH_INDEX) {
      expect(navKeys.has(entry.nav), `${entry.label} -> ${entry.nav}`).toBe(true)
    }
  })

  it('wires the settings UI to field-level results', () => {
    expect(settingsSource).toContain('settings-search-results')
    expect(settingsSource).toContain('handleSearchResultSelect')
    expect(settingsSource).toContain('settings-field-flash')
    expect(settingsSource).toContain('settings-theme-option')
  })
})
