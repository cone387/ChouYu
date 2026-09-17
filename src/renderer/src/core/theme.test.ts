import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolvePalette, resolveTheme } from './theme'
import { PALETTE_IDS } from '../../../shared/config'
import { searchSettings, SETTINGS_SEARCH_INDEX } from '../components/Settings/settings-search-index'

const stylesheet = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles/index.css'), 'utf8')
const settingsSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/Settings/Settings.tsx'), 'utf8')
const configSource = readFileSync(resolve(process.cwd(), 'src/shared/config.ts'), 'utf8')
const themeSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/core/theme.ts'), 'utf8')
const petSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/Pet/PetSvg.tsx'), 'utf8')
const messageAreaSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ChatPanel/MessageArea.tsx'), 'utf8')
const chatPanelCss = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ChatPanel/ChatPanel.css'), 'utf8')
const workspaceNavSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/Workspace/WorkspaceNav.tsx'), 'utf8')

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

  it('resolves the palette with a purple fallback for unknown values', () => {
    expect(resolvePalette('pink')).toBe('pink')
    expect(resolvePalette(undefined)).toBe('purple')
    expect(resolvePalette('gold')).toBe('purple')
  })

  it('defines light and dark accent overrides for every non-default palette', () => {
    const accentVars = ['--accent:', '--accent-hover:', '--focus-ring:', '--user-msg-bg:', '--hover-bg:', '--hljs-keyword:']
    for (const palette of PALETTE_IDS.filter((id) => id !== 'purple')) {
      const light = darkVarBlock(stylesheet, `:root[data-palette='${palette}']`)
      const dark = darkVarBlock(stylesheet, `:root[data-theme='dark'][data-palette='${palette}']`)
      expect(light, `${palette} light block`).not.toBe('')
      expect(dark, `${palette} dark block`).not.toBe('')
      for (const token of accentVars) {
        expect(light, `${palette} light ${token}`).toContain(token)
        expect(dark, `${palette} dark ${token}`).toContain(token)
      }
    }
  })

  it('keeps text and solid button labels readable in every palette and theme', () => {
    const tokens = (block: string) => Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*(#[\da-f]{6})\s*;/gi)].map(match => [match[1], match[2]]))
    const light = tokens(darkVarBlock(stylesheet, ':root {'))
    const dark = { ...light, ...tokens(darkVarBlock(stylesheet, ":root[data-theme='dark']")) }
    const luminance = (hex: string) => {
      const channels = hex.slice(1).match(/../g)!.map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
    }
    const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05)
    for (const theme of ['light', 'dark']) {
      for (const palette of PALETTE_IDS) {
        const values = { ...(theme === 'light' ? light : dark), ...tokens(darkVarBlock(stylesheet, theme === 'light' ? `:root[data-palette='${palette}']` : `:root[data-theme='dark'][data-palette='${palette}']`)) }
        for (const [foreground, background] of [['--on-accent', '--accent'], ['--on-accent', '--accent-hover'], ['--on-error', '--error'], ['--text-primary', '--bg-primary'], ['--text-secondary', '--bg-secondary'], ['--text-muted', '--bg-secondary'], ['--accent', '--bg-primary'], ['--hljs-comment', '--code-bg']]) {
          expect(contrast(values[foreground], values[background]), `${theme}/${palette}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })

  it('wires the config palette into the html attribute', () => {
    expect(themeSource).toContain('dataset.palette = resolvePalette(palettePreference)')
  })

  it('replaces hardcoded purple fills with the accent variable', () => {
    expect(petSource).toContain('fill="var(--accent)"')
    expect(petSource).not.toContain('#6C5CE7')
    expect(messageAreaSource).not.toContain('#6C5CE7')
    expect(settingsSource).not.toContain('#6C5CE7')
    expect(workspaceNavSource).toContain('fill="var(--accent)"')
    expect(workspaceNavSource).not.toContain('PET_ICON_SVG')
  })

  it('derives chat shadows from the accent color', () => {
    expect(chatPanelCss).not.toContain('rgba(108, 92, 231')
    expect(chatPanelCss).toContain('color-mix(in srgb, var(--accent) 20%, transparent)')
    expect(chatPanelCss).toContain('color-mix(in srgb, var(--accent) 10%, transparent)')
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
    const navKeys = new Set(['ai', 'tools', 'memory', 'journal', 'capabilities', 'persona', 'general', 'about'])
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

  it('surfaces the palette picker through settings search', () => {
    expect(searchSettings('配色').some((entry) => entry.fieldId === 'settings-theme-label')).toBe(true)
    expect(settingsSource).toContain('settings-palette-swatch')
    expect(settingsSource).toContain('PALETTE_SWATCHES')
    for (const id of PALETTE_IDS) {
      expect(settingsSource, `swatch for ${id}`).toContain(`{ id: '${id}'`)
    }
  })
})
