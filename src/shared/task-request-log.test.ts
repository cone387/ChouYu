import { expect, it } from 'vitest'
import { appendTaskRequestLog } from './task-request-log'
it('retains original requirements and recent changes with an explicit gap when full', () => {
  const result = appendTaskRequestLog('原始要求' + '旧'.repeat(7990), '最新修改' + '新'.repeat(2000))
  expect(result.length).toBeLessThanOrEqual(8000)
  expect(result.startsWith('原始要求')).toBe(true)
  expect(result).toContain('最新修改')
  expect(result).toContain('中间沟通因长度限制未保留')
})
