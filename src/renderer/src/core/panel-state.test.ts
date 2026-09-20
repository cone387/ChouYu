import { describe, expect, it } from 'vitest'
import { getDefaultPanelHeight, normalizeChatContentWidth, normalizePanelHeight, normalizeSessionSidebarWidth, parseStoredSidebarVisibility } from './panel-state'

describe('panel UI state', () => {
  it('derives a responsive default with safe bounds', () => {
    expect(getDefaultPanelHeight(400)).toBe(280)
    expect(getDefaultPanelHeight(900)).toBe(522)
    expect(getDefaultPanelHeight(2000)).toBe(720)
  })

  it('restores saved height beyond the viewport while keeping a minimum', () => {
    expect(normalizePanelHeight('480', 900)).toBe(480)
    expect(normalizePanelHeight('120', 900)).toBe(280)
    expect(normalizePanelHeight('1200', 700)).toBe(1200)
    expect(normalizePanelHeight('invalid', 900)).toBe(522)
  })

  it('restores the sidebar only from an explicit true value', () => {
    expect(parseStoredSidebarVisibility('true')).toBe(true)
    expect(parseStoredSidebarVisibility('false')).toBe(false)
    expect(parseStoredSidebarVisibility(null)).toBe(false)
  })

  it('restores sidebar width without an upper limit', () => {
    expect(normalizeSessionSidebarWidth('300')).toBe(300)
    expect(normalizeSessionSidebarWidth('100')).toBe(220)
    expect(normalizeSessionSidebarWidth('600')).toBe(600)
    expect(normalizeSessionSidebarWidth('invalid')).toBe(252)
  })

  it('restores chat content width without an upper limit', () => {
    expect(normalizeChatContentWidth('520')).toBe(520)
    expect(normalizeChatContentWidth('200')).toBe(360)
    expect(normalizeChatContentWidth('2400')).toBe(2400)
    expect(normalizeChatContentWidth('invalid')).toBe(420)
  })
})
