import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const tokens = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles/tokens.css'), 'utf8')
const mainEntry = readFileSync(resolve(process.cwd(), 'src/renderer/src/main.tsx'), 'utf8')
const tokenisedStyles: Record<string, string> = Object.fromEntries([
  'src/renderer/src/components/ChatPanel/ChatPanel.css',
  'src/renderer/src/components/Settings/Settings.css',
  'src/renderer/src/components/Settings/MemorySettingsTab.css',
  'src/renderer/src/components/ConversationSidebar/ConversationSidebar.css'
].map((path) => [path, readFileSync(resolve(process.cwd(), path), 'utf8')]))

describe('design token guardrails', () => {
  it('defines the spacing, radius and typography token scales', () => {
    for (const token of ['--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-7']) {
      expect(tokens).toContain(`${token}: `)
    }
    for (const token of ['--radius-sm', '--radius-md', '--radius-lg', '--radius-xl', '--radius-2xl', '--radius-pill', '--radius-round']) {
      expect(tokens).toContain(`${token}: `)
    }
    for (const token of ['--font-xs', '--font-sm', '--font-md', '--font-base', '--font-mono']) {
      expect(tokens).toContain(`${token}: `)
    }
  })

  it('loads tokens before the global stylesheet', () => {
    expect(mainEntry).toContain("import './styles/tokens.css'")
    expect(mainEntry.indexOf("import './styles/tokens.css'")).toBeLessThan(mainEntry.indexOf("import './styles/index.css'"))
  })

  it('keeps migrated stylesheets on the token scale', () => {
    for (const [path, stylesheet] of Object.entries(tokenisedStyles)) {
      const violations = stylesheet.match(/(?:padding|margin|margin-top|margin-right|margin-bottom|margin-left|gap|row-gap|column-gap|border-radius)\s*:\s*[^;}]*-?\d+px[^;}]*;/g) || []
      // calc() expressions legitimately mix px with viewport units or negate tokens; tokenise their inputs instead.
      const hardCoded = violations.filter((line) => !line.includes('calc('))
      expect(hardCoded, `${path} hard-coded spacing/radius values:\n${hardCoded.join('\n')}`).toEqual([])
    }
  })
})
