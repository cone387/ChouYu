/** Close large backlogs faster, easing into the newest row without overshooting. */
export function advanceLogScroll(current: number, target: number, elapsedMs: number): number {
  if (target <= current || target - current < 0.75) return target
  return current + (target - current) * (1 - Math.exp(-Math.max(0, elapsedMs) / 180))
}
