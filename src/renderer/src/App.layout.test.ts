import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/App.tsx'), 'utf8')

describe('panel opening placement', () => {
  it('uses a centered default and restores a dragged panel position', () => {
    expect(source).toContain('getCenteredPanelPosition')
    expect(source).toContain("getState('panel-position')")
    expect(source).toContain("setState('panel-position'")
    expect(source).toContain('getDefaultPanelHeight(window.innerHeight)')
    expect(source).not.toContain('const isTop = petCenterY < screenH / 3')
  })
})
