import { describe, expect, test } from 'vitest'
import { defaultTaskNavConfig, normalizeTaskNavConfig, parseTaskNavConfig } from './taskViewConfig'

describe('taskViewConfig', () => {
  test('默认：智能视图顺序，done 收进更多', () => {
    expect(defaultTaskNavConfig()).toEqual({ order: ['today', 'week', 'unplanned', 'all', 'overdue', 'done'], hidden: ['done'] })
    expect(parseTaskNavConfig(null)).toEqual(defaultTaskNavConfig())
    expect(parseTaskNavConfig('not json')).toEqual(defaultTaskNavConfig())
  })
  test('解析保留合法项并去掉不在 order 里的 hidden', () => {
    expect(parseTaskNavConfig('{"order":["all","today","view:x"],"hidden":["today","gone"]}')).toEqual({ order: ['all', 'today', 'view:x'], hidden: ['today'] })
  })
  test('归一化：补齐缺失智能键、追加新视图并默认收起、剔除已删视图', () => {
    const normalized = normalizeTaskNavConfig({ order: ['today', 'view:old', 'view:keep'], hidden: ['view:old'] }, [{ id: 'keep' }, { id: 'new' }])
    expect(normalized.order).toEqual(['today', 'view:keep', 'week', 'unplanned', 'all', 'overdue', 'done', 'view:new'])
    expect(normalized.hidden).toEqual(['view:new'])
  })
})
