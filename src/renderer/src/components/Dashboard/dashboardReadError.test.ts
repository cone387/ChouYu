import { expect, it, vi } from 'vitest'
import { dashboardReadError, readUsageStatistics } from './dashboardReadError'

it('explains an outdated preload instead of failing with a generic TypeError', async () => {
  await expect(readUsageStatistics(7, {})).rejects.toThrow('重新打开应用')
})
it('explains an outdated main process when the new preload has loaded', async () => {
  const api = { usage: { statistics: vi.fn().mockRejectedValue(new Error("Error invoking remote method 'usage:statistics': Error: No handler registered for 'usage:statistics'")) } }
  await expect(readUsageStatistics(7, api)).rejects.toThrow('重新打开应用')
})
it('only refers to previous results when the current range actually has data', () => {
  expect(dashboardReadError(new Error('database error'), false)).toBe('读取失败，请重试。')
  expect(dashboardReadError(new Error('database error'), true)).toBe('读取失败，请重试。已显示的数据为上次读取结果。')
})
it('preserves valid statistics and does not expose unexpected internal errors', async () => {
  const api = { usage: { statistics: vi.fn().mockResolvedValue({ tokens: 0, calls: 0 }) } }
  expect(await readUsageStatistics(30, api)).toEqual({ tokens: 0, calls: 0 })
  expect(api.usage.statistics).toHaveBeenCalledWith(30)
  api.usage.statistics.mockRejectedValue(new Error('private path'))
  try { await readUsageStatistics(7, api) } catch (error) { expect(dashboardReadError(error, false)).not.toContain('private path') }
})
