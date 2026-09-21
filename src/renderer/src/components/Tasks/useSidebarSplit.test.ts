import { describe, expect, test } from 'vitest'
import { parseSidebarSplit } from './useSidebarSplit'

describe('parseSidebarSplit', () => {
  test('合法像素值保留，空/非法/越界恢复 auto', () => {
    expect(parseSidebarSplit(null)).toBeNull()
    expect(parseSidebarSplit('300')).toBe(300)
    expect(parseSidebarSplit('99')).toBeNull()
    expect(parseSidebarSplit('5000')).toBeNull()
    expect(parseSidebarSplit('abc')).toBeNull()
  })
})
