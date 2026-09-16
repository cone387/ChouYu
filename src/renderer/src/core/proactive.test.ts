import { describe, expect, test } from 'vitest'
import { ProactiveEngine } from './proactive'

describe('ProactiveEngine.postExternal', () => {
  test('外部消息绕过冷却直接入列并回调,最新在前', () => {
    const engine = new ProactiveEngine()
    const seen: Array<{ message: string; kind?: string }> = []
    engine.start((message, kind) => { seen.push({ message, kind }) }, { greeting: false, restReminder: false })
    engine.postExternal('任务提醒：写周报', 'task')
    engine.postExternal('错过了 2 条任务提醒', 'task')
    const messages = engine.getMessages()
    expect(messages).toHaveLength(2)
    expect(messages[0].message).toBe('错过了 2 条任务提醒')
    expect(messages.every(item => item.kind === 'task')).toBe(true)
    expect(seen).toHaveLength(2)
    expect(seen.every(item => item.kind === 'task')).toBe(true)
    engine.stop()
  })

  test('postExternal 消息可被 hydrateMessages 保留', () => {
    const engine = new ProactiveEngine()
    engine.start(() => {}, { greeting: false, restReminder: false })
    engine.postExternal('任务提醒：写周报', 'task')
    const snapshot = engine.getMessages()
    engine.hydrateMessages(snapshot)
    expect(engine.getMessages()[0].message).toBe('任务提醒：写周报')
    engine.stop()
  })
})
