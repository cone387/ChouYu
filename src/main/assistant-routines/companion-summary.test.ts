import { afterEach, expect, it, vi } from 'vitest'
import { streamAIChat } from '../ai'
import { routineSummaryInput, summarizeCompanionWork } from './companion-summary'
import { DEFAULT_APP_CONFIG } from '../../shared/config'
import { contactCommunicationRules } from '../../shared/contact-communication'
vi.mock('../ai', () => ({ streamAIChat: vi.fn() }))
afterEach(() => vi.useRealTimers())

it('grounds a delayed midnight briefing in the local check date, not the UTC or scheduled date', () => {
  const input = routineSummaryInput('检查重试时间', Date.parse('2026-10-13T15:56:00Z'), Date.parse('2026-10-12T16:56:00Z'), {
    checkedAt: '2026-10-13T16:56:00Z', timeZone: 'Asia/Shanghai', contacts: []
  })
  expect(input).toMatchObject({
    检查时间: { 本地时间: '2026-10-14 00:56:00', 时区: 'Asia/Shanghai' },
    计划时间: '2026-10-13 23:56:00', 上次汇报时间: '2026-10-13 00:56:00'
  })
})

it('formats a western time zone on its local date instead of the following UTC date', () => {
  expect(routineSummaryInput('检查', Date.parse('2026-10-14T01:56:00Z'), undefined, {
    checkedAt: '2026-10-14T02:56:00Z', timeZone: 'America/Los_Angeles'
  })).toMatchObject({
    检查时间: { 本地时间: '2026-10-13 19:56:00', 时区: 'America/Los_Angeles' },
    计划时间: '2026-10-13 18:56:00', 上次汇报时间: null
  })
})

it('sends the actual local check clock for greeting and return summaries', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-13T16:56:00Z'))
  vi.mocked(streamAIChat).mockImplementationOnce(async (messages, _system, _config, callback) => {
    const clock = JSON.parse(messages[0].content).检查时间
    expect(clock).toBeDefined()
    // The configured machine zone is the production source, not a hard-coded China offset.
    expect(clock.时区).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
    expect(clock.本地时间).toMatch(/^2026-10-\d{2} \d{2}:56:00$/)
    callback('等待自动重试。', false)
  })
  expect(await summarizeCompanionWork([], DEFAULT_APP_CONFIG, '')).toBe('等待自动重试。')
})
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
