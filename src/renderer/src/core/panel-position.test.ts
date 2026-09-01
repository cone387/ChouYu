import { describe, expect, it } from 'vitest'
import { clampPanelPosition, getAnchoredPanelPosition, getCenteredPanelPosition } from './panel-position'

const viewport = { width: 1440, height: 900 }
const panel = { width: 420, height: 520 }

describe('panel anchoring', () => {
  it('centers a panel by default within the viewport', () => {
    expect(getCenteredPanelPosition(panel, viewport)).toEqual({ x: 510, y: 190 })
    expect(getCenteredPanelPosition({ width: 2000, height: 1200 }, viewport)).toEqual({ x: 8, y: 8 })
  })

  it('clamps a remembered position after a viewport change', () => {
    expect(clampPanelPosition({ x: 1200, y: 700 }, panel, { width: 1024, height: 768 })).toEqual({ x: 596, y: 240 })
  })

  it('prefers the side with enough space and aligns the top edge', () => {
    expect(getAnchoredPanelPosition({ x: 100, y: 120, width: 80, height: 80 }, panel, viewport)).toEqual({ x: 192, y: 120 })
    expect(getAnchoredPanelPosition({ x: 1200, y: 120, width: 80, height: 80 }, panel, viewport)).toEqual({ x: 768, y: 120 })
  })

  it('uses the side with more room when neither side fully fits', () => {
    expect(getAnchoredPanelPosition({ x: 600, y: 120, width: 80, height: 80 }, { width: 700, height: 400 }, viewport)).toEqual({ x: 692, y: 120 })
  })

  it('clamps oversized or edge-adjacent panels without flipping vertically', () => {
    expect(getAnchoredPanelPosition({ x: 10, y: 820, width: 80, height: 80 }, panel, viewport)).toEqual({ x: 102, y: 372 })
    expect(getAnchoredPanelPosition({ x: 0, y: 0, width: 80, height: 80 }, { width: 2000, height: 1200 }, viewport)).toEqual({ x: 8, y: 8 })
  })
})
