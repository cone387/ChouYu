import { expect, it } from 'vitest'
import { advanceLogScroll } from './logScroll'

it('catches a larger backlog faster in the same amount of time', () => {
  expect(advanceLogScroll(0, 1000, 16)).toBeGreaterThan(advanceLogScroll(0, 100, 16) * 9)
})
it('eases into the tail without overshooting and settles exactly', () => {
  let position = 0
  for (let frame = 0; frame < 120; frame++) {
    const next = advanceLogScroll(position, 400, 16)
    expect(next).toBeGreaterThanOrEqual(position)
    expect(next).toBeLessThanOrEqual(400)
    position = next
  }
  expect(position).toBe(400)
  expect(advanceLogScroll(400, 120, 16)).toBe(120)
})
