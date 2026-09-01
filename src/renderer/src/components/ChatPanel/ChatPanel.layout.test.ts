import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ChatPanel/ChatPanel.css'), 'utf8')
const panelSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ChatPanel/ChatPanel.tsx'), 'utf8')
const sidebarSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ConversationSidebar/ConversationSidebar.tsx'), 'utf8')
const sidebarStylesheet = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ConversationSidebar/ConversationSidebar.css'), 'utf8')
const inputSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ChatPanel/InputArea.tsx'), 'utf8')

describe('chat layout guardrails', () => {
  it('keeps the composer on one row and never enables horizontal scrolling', () => {
    expect(stylesheet).toMatch(/\.input-toolbar\s*\{[\s\S]*flex-wrap:\s*nowrap/)
    expect(stylesheet).not.toMatch(/overflow-x\s*:\s*(auto|scroll)/)
  })

  it('keeps upward menus visible while message content remains clipped safely', () => {
    expect(stylesheet).toMatch(/\.chat-panel-main\s*\{[\s\S]*overflow:\s*visible/)
    expect(stylesheet).toMatch(/\.message-bubble\s*\{[\s\S]*overflow-x:\s*hidden/)
  })

  it('keeps short session workspaces compact and anchors the composer', () => {
    expect(stylesheet).toMatch(/\.chat-panel-workspace\s*\{[\s\S]*height:\s*auto/)
    expect(stylesheet).toMatch(/\.chat-panel-main > \.input-area\s*\{\s*margin-top:\s*auto/)
    expect(stylesheet).toMatch(/\.panel-resize-edge\s*\{[\s\S]*cursor:\s*ns-resize/)
    expect(panelSource).toContain('const rect = panelEl.getBoundingClientRect()')
    expect(panelSource).toContain('getDefaultPanelHeight(window.innerHeight)')
    expect(panelSource).toContain("height: !showSettings ? panelHeight : undefined")
    expect(panelSource).toContain("(['top', 'bottom'] as const)")
  })

  it('uses the top-bar session toggle as the only close control', () => {
    expect(panelSource).not.toContain('onClose={() => setShowSessions(false)}')
    expect(panelSource).toContain('dragHandleProps={{')
    expect(sidebarSource).not.toContain('aria-label="关闭对话列表"')
  })

  it('places session actions behind a single top-right menu button', () => {
    expect(sidebarStylesheet).toMatch(/\.conversation-item-menu\s*\{[\s\S]*right:\s*9px[\s\S]*top:\s*6px/)
    expect(sidebarStylesheet).toMatch(/\.conversation-menu-trigger\s*\{[\s\S]*width:\s*28px[\s\S]*height:\s*28px/)
    expect(sidebarSource).toContain('aria-haspopup="menu"')
    expect(sidebarSource).toContain('role="menuitem"')
    expect(sidebarStylesheet).toMatch(/\.conversation-item-main\s*\{[\s\S]*padding:\s*8px 9px 7px/)
    expect(sidebarStylesheet).toMatch(/\.conversation-item-title-row,[\s\S]*padding-right:\s*34px/)
  })

  it('preserves visible session order while switching the active card', () => {
    expect(panelSource).toContain('mergeSessionsInCurrentOrder')
    expect(panelSource).toContain('await persistCurrentSession(true)')
    expect(panelSource).toContain('db.selectSession(id), true')
  })

  it('persists panel height and explicit sidebar visibility changes', () => {
    expect(panelSource).toContain('PANEL_HEIGHT_STATE_KEY')
    expect(panelSource).toContain('SESSION_SIDEBAR_STATE_KEY')
    expect(panelSource).toContain('db.setState(PANEL_HEIGHT_STATE_KEY')
    expect(panelSource).toContain('db.setState(SESSION_SIDEBAR_STATE_KEY')
    expect(panelSource).toContain('SESSION_SIDEBAR_WIDTH_STATE_KEY')
    expect(panelSource).toContain('aria-label="调整会话列表宽度"')
    expect(panelSource).toContain('style={{ left: sessionSidebarWidth - 4 }}')
    expect(panelSource).toContain('SESSION_SIDEBAR_WIDTH_STATE_KEY')
    expect(panelSource).toContain('CHAT_CONTENT_WIDTH_STATE_KEY')
    expect(panelSource).toContain('aria-label="调整聊天内容区宽度"')
    expect(stylesheet).toMatch(/\.chat-content-resize-edge\s*\{[\s\S]*cursor:\s*ew-resize/)
    expect(stylesheet).toMatch(/\.chat-content-resize-edge:hover,[\s\S]*box-shadow:\s*none/)
  })

  it('focuses the composer only on explicit chat-entry transitions', () => {
    expect(inputSource).toContain('focusRequest?: number')
    expect(inputSource).toContain('focus({ preventScroll: true })')
    expect(inputSource).not.toContain('setTimeout(tryFocus')
    expect(panelSource).toContain('requestComposerFocus()')
    expect(panelSource).toContain('focusRequest={composerFocusRequest}')
  })

  it('keeps AI generations isolated by session while navigating', () => {
    expect(panelSource).toContain('sessionGenerationsRef')
    expect(panelSource).toContain('requestSessionRef')
    expect(panelSource).toContain('sessionMessagesRef')
    expect(panelSource).not.toContain('stopActiveResponse()')
    expect(sidebarSource).toContain('streamingSessionIds.has(session.id)')
  })
})
