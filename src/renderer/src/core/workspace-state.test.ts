import { describe, expect, it } from 'vitest'
import { getWorkspaceGeometry, parseWorkspaceMode } from './workspace-state'

describe('workspace presentation', () => {
  const viewport = { width: 1280, height: 900 }
  it('accepts only known saved modes', () => {
    expect(parseWorkspaceMode('chat')).toBe('chat')
    expect(parseWorkspaceMode('sessions')).toBe('sessions')
    expect(parseWorkspaceMode(null)).toBe('workspace')
    expect(parseWorkspaceMode('invalid')).toBe('workspace')
  })
  it('only allocates the columns requested by the mode', () => {
    expect(getWorkspaceGeometry('workspace', false, viewport, 420, 252, 500).width).toBe(728)
    expect(getWorkspaceGeometry('sessions', false, viewport, 420, 252, 500)).toMatchObject({ width: 672, chromeWidth: 0, narrow: false })
    expect(getWorkspaceGeometry('chat', false, viewport, 420, 252, 500).width).toBe(420)
  })
  it('maximizes within the work area without changing saved dimensions', () => {
    expect(getWorkspaceGeometry('workspace', true, viewport, 420, 252, 500)).toMatchObject({ width: 1272, height: 892 })
    expect(getWorkspaceGeometry('workspace', false, viewport, 420, 252, 500)).toMatchObject({ width: 728, height: 500 })
  })
  it('uses an overlay for two-column mode on narrow displays', () => {
    expect(getWorkspaceGeometry('sessions', false, { width: 375, height: 768 }, 420, 252, 500)).toMatchObject({ width: 359, narrow: true })
  })
})
