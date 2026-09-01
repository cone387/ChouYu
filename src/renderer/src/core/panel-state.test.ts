import { describe, expect, it } from 'vitest'
import { getDefaultPanelHeight, normalizePanelHeight, normalizeSessionSidebarWidth, parseStoredSidebarVisibility } from './panel-state'

describe('panel UI state', () => {
  it('derives a responsive default with safe bounds', () => {
    expect(getDefaultPanelHeight(400)).toBe(280)
    expect(getDefaultPanelHeight(900)).toBe(522)
    expect(getDefaultPanelHeight(2000)).toBe(720)
  })

  it('restores saved height inside the current viewport', () => {
    expect(normalizePanelHeight('480', 900)).toBe(480)
    expect(normalizePanelHeight('120', 900)).toBe(280)
    expect(normalizePanelHeight('1200', 700)).toBe(692)
    expect(normalizePanelHeight('invalid', 900)).toBe(522)
  })

  it('restores the sidebar only from an explicit true value', () => {
    expect(parseStoredSidebarVisibility('true')).toBe(true)
    expect(parseStoredSidebarVisibility('false')).toBe(false)
    expect(parseStoredSidebarVisibility(null)).toBe(false)
  })

  it('restores sidebar width within its supported range', () => {
    expect(normalizeSessionSidebarWidth('300')).toBe(300)
    expect(normalizeSessionSidebarWidth('100')).toBe(220)
    expect(normalizeSessionSidebarWidth('600')).toBe(380)
    expect(normalizeSessionSidebarWidth('invalid')).toBe(252)
  })
})
