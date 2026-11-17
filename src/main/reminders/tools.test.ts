import { expect, it } from 'vitest'
import { createReminderTools } from './tools'
import type { ReminderView } from '../../shared/reminder-followups'
const item: ReminderView = { id: 'r', owner: 'alice', sessionId: 's', messageId: 'm', label: '喝水', source: { kind: 'message' }, status: 'pending', acknowledgement: 'done', createdAt: 1, nextAt: 1800001, intervalMinutes: 30, revision: 1, read: true }
it('lists current-session reminders and rejects a foreign or stale item before editing', async () => {
  let changed = false
  const tools = createReminderTools({ list: async session => session === 's' ? [item] : [], act: async () => { changed = true; return item } })
  const context = { sessionId: 's' } as any
  expect(JSON.parse((await tools[0].execute({}, context)).content).items[0]).toMatchObject({ label: '喝水', status: 'pending', read: true })
  await expect(tools[1].execute({ id: 'r', revision: 1, action: 'interval', minutes: 60 }, { sessionId: 'other' } as any)).rejects.toThrow('当前会话')
  await expect(tools[1].execute({ id: 'r', revision: 0, action: 'interval', minutes: 60 }, context)).rejects.toThrow('变化')
  expect(changed).toBe(false)
})
it('validates a single natural-language adjustment and returns the actually saved value', async () => {
  let intervalMinutes = 30
  const tools = createReminderTools({ list: async () => [item], act: async (_id, _revision, action, minutes) => {
    if (action === 'interval') intervalMinutes = minutes!
    return { ...item, intervalMinutes, revision: 2 }
  } })
  const context = { sessionId: 's' } as any
  await expect(tools[1].execute({ id: 'r', revision: 1, action: 'interval', minutes: -1 }, context)).rejects.toThrow('1～1440')
  expect(intervalMinutes).toBe(30)
  const response = await tools[1].execute({ id: 'r', revision: 1, action: 'interval', minutes: 60 }, context)
  expect(JSON.parse(response.content).intervalMinutes).toBe(60)
})
