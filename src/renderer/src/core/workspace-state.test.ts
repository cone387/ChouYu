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
    expect(getWorkspaceGeometry('workspace', true, viewport, 420, 252, 500)).toMatchObject({ width: 1280, height: 900 })
    expect(getWorkspaceGeometry('workspace', false, viewport, 420, 252, 500)).toMatchObject({ width: 728, height: 500 })
  })
  it('preserves requested dimensions even beyond the display', () => {
    expect(getWorkspaceGeometry('sessions', false, { width: 375, height: 768 }, 420, 252, 1200)).toMatchObject({ width: 672, height: 1200, narrow: false })
    expect(getWorkspaceGeometry('workspace', false, viewport, 2400, 600, 1600)).toMatchObject({ width: 3056, height: 1600 })
    expect(getWorkspaceGeometry('workspace', true, viewport, 2400, 600, 1600)).toMatchObject({ width: 1280, height: 900 })
    expect(getWorkspaceGeometry('workspace', false, viewport, 2400, 600, 1600)).toMatchObject({ width: 3056, height: 1600 })
  })
  it('uses narrow layout based on the panel size', () => {
    expect(getWorkspaceGeometry('chat', false, viewport, 360, 252, 500)).toMatchObject({ width: 360, narrow: true })
  })
})
