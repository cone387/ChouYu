import { expect, it, vi } from 'vitest'
import { streamAIChat } from '../ai'
import { summarizeCompanionWork } from './companion-summary'
import { DEFAULT_APP_CONFIG } from '../../shared/config'
vi.mock('../ai', () => ({ streamAIChat: vi.fn() }))
it('excludes stale next-step plans from factual summaries, keeps questions and supplies no tools', async () => {
  const task = { runStatus: 'failed', nextStep: '等待用户选择范围', error: '503', question: '' }
  vi.mocked(streamAIChat).mockImplementationOnce(async (messages, _system, _config, callback, _signal, tools) => {
    const input = JSON.parse(messages[0].content)
    expect(input.tasks[0]).toMatchObject({ runStatus: 'failed', error: '503' })
    expect(input.tasks[0]).not.toHaveProperty('nextStep')
    expect(tools).toBeUndefined()
    callback('资料接口失败。', false)
  })
  expect(await summarizeCompanionWork([task], DEFAULT_APP_CONFIG, '')).toBe('资料接口失败。')
  expect(task.nextStep).toBe('等待用户选择范围')
})
