import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ChatPanel/ChatPanel.css'), 'utf8')

describe('chat layout guardrails', () => {
  it('keeps the composer on one row and never enables horizontal scrolling', () => {
    expect(stylesheet).toMatch(/\.input-toolbar\s*\{[\s\S]*flex-wrap:\s*nowrap/)
    expect(stylesheet).not.toMatch(/overflow-x\s*:\s*(auto|scroll)/)
  })

  it('keeps upward menus visible while message content remains clipped safely', () => {
    expect(stylesheet).toMatch(/\.chat-panel-main\s*\{[\s\S]*overflow:\s*visible/)
    expect(stylesheet).toMatch(/\.message-bubble\s*\{[\s\S]*overflow-x:\s*hidden/)
  })
})
