export interface PanelAnchor {
  x: number
  y: number
  width: number
  height: number
}

export interface ViewportSize {
  width: number
  height: number
}

export interface PanelPosition {
  x: number
  y: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * Place a panel beside the desktop pet using one deterministic rule for chat,
 * sessions and settings. The panel keeps the pet's top edge when possible;
 * only viewport boundaries can move it vertically.
 */
export function getAnchoredPanelPosition(
  pet: PanelAnchor,
  panel: Pick<PanelAnchor, 'width' | 'height'>,
  viewport: ViewportSize,
  gap = 12,
  inset = 8
): PanelPosition {
  const rightSpace = viewport.width - (pet.x + pet.width) - inset
  const leftSpace = pet.x - inset
  const placeRight = rightSpace >= panel.width || rightSpace >= leftSpace
  const preferredX = placeRight
    ? pet.x + pet.width + gap
    : pet.x - panel.width - gap
  const x = clamp(preferredX, inset, viewport.width - panel.width - inset)
  const y = clamp(pet.y, inset, viewport.height - panel.height - inset)
  return { x, y }
}

export function getCenteredPanelPosition(
  panel: Pick<PanelAnchor, 'width' | 'height'>,
  viewport: ViewportSize,
  inset = 8
): PanelPosition {
  return {
    x: clamp((viewport.width - panel.width) / 2, inset, viewport.width - panel.width - inset),
    y: clamp((viewport.height - panel.height) / 2, inset, viewport.height - panel.height - inset)
  }
}

export function clampPanelPosition(
  position: PanelPosition,
  panel: Pick<PanelAnchor, 'width' | 'height'>,
  viewport: ViewportSize,
  inset = 8
): PanelPosition {
  return {
    x: clamp(position.x, inset, viewport.width - panel.width - inset),
    y: clamp(position.y, inset, viewport.height - panel.height - inset)
  }
}
