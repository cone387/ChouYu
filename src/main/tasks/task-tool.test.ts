import { describe, expect, test, vi } from 'vitest'
import { createTaskTool } from './task-tool'
import { shouldConfirmTool } from '../../shared/tools'
import type { TaskRecord } from '../../shared/tasks'
import type { ToolExecutionContext } from '../tools/registry'

describe('confirmed task creation', () => {
  test('requires explicit confirmation in every permission mode', () => {
    const create = vi.fn()
    const tool = createTaskTool(create, () => ({ title: '来源' }))
    for (const mode of ['confirm', 'auto', 'full'] as const) expect(shouldConfirmTool(tool, mode)).toBe(true)
    expect(create).not.toHaveBeenCalled()
  })
  test('uses the requesting session rather than model-supplied source, returns a navigable result', async () => {
    const create = vi.fn(() => ({ id: 'task-result', title: '跟进', status: 'open' }) as TaskRecord)
    const tool = createTaskTool(create, id => id === 'actual-session' ? { title: '讨论' } : null)
    const context = { sessionId: 'actual-session' } as ToolExecutionContext
    const result = await tool.execute({ title: '跟进', source: { id: 'forged' }, dueAt: '2026-09-24T09:00:00+08:00' }, context)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: '跟进', dueAt: Date.parse('2026-09-24T09:00:00+08:00'), source: { kind: 'chat', id: 'actual-session', label: '讨论' } }))
    expect(result.taskId).toBe('task-result')
    expect(() => tool.execute({ title: '跟进' }, { sessionId: 'deleted' } as ToolExecutionContext)).toThrow('来源会话不存在')
    expect(() => tool.execute({ title: '跟进', dueAt: '2026-09-24' }, context)).toThrow('时区')
    expect(create).toHaveBeenCalledTimes(1)
  })
})
