import { expect, it, vi } from 'vitest'
import { streamAIChat } from '../ai'
import { summarizeCompanionWork } from './companion-summary'
import { DEFAULT_APP_CONFIG } from '../../shared/config'
import { contactCommunicationRules } from '../../shared/contact-communication'
vi.mock('../ai', () => ({ streamAIChat: vi.fn() }))
it('includes skill methods without replacing the companion contract', async () => {
  vi.mocked(streamAIChat).mockImplementationOnce(async (_messages, system, _config, callback) => {
    expect(system).toContain('技能方法：先给依据')
    expect(system).toContain(contactCommunicationRules)
    callback('已核对。', false)
  })
  expect(await summarizeCompanionWork([], DEFAULT_APP_CONFIG, '独立人设', undefined, '技能方法：先给依据')).toBe('已核对。')
})
it('excludes stale next-step plans from factual summaries, keeps questions and supplies no tools', async () => {
  const task = { runStatus: 'failed', nextStep: '等待用户选择范围', error: '503', question: '' }
  vi.mocked(streamAIChat).mockImplementationOnce(async (messages, system, _config, callback, _signal, tools) => {
    expect(system).toContain(contactCommunicationRules)
    const input = JSON.parse(messages[0].content)
    expect(input.tasks[0]).toMatchObject({ runStatus: 'failed', error: '503' })
    expect(input.tasks[0]).not.toHaveProperty('nextStep')
    expect(tools).toBeUndefined()
    callback('资料接口失败。', false)
  })
  expect(await summarizeCompanionWork([task], DEFAULT_APP_CONFIG, '')).toBe('资料接口失败。')
  expect(task.nextStep).toBe('等待用户选择范围')
})
