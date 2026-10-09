import { expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, type AgentOverview, type AgentTopic, type AgentTopicMetrics } from './agents'
import { contactWorkStatus, taskWorkStatus, withinWorkHours } from './work-settings'

const topic: AgentTopic = { id: 'task', characterId: 'alice', title: '研究任务', goal: '验证需求', constraints: '', revision: 1, status: 'researching', judgement: '', openQuestions: '', nextStep: '', reason: '', createdAt: 0, updatedAt: 0, resourceBudget: { modelCalls: 10, reason: '已分配' } }
const overview = (): AgentOverview => ({ settings: { ...DEFAULT_AGENT_SETTINGS, goal: '研究', enabled: true, dailyCalls: 40 }, revision: 1, nextAt: 0, callsToday: 0, topics: [topic], focusTopicId: topic.id, runs: [], memories: [], reports: [], topicMetrics: { [topic.id]: { calls: 10 } as AgentTopicMetrics } })

it('explains the task budget even when the contact has ample daily allowance', () => {
  const data = overview()
  expect(contactWorkStatus(data, true)).toContain('累计预算不足')
  expect(taskWorkStatus(data, topic)).toContain('累计预算不足')
})

it('does not describe paused tasks as resumed merely because automatic work is enabled', () => {
  const data = overview(), paused = { ...topic, status: 'paused' as const }
  data.topics = [paused]
  expect(contactWorkStatus(data, true)).toContain('不会恢复已暂停')
  expect(taskWorkStatus(data, paused)).toContain('不会恢复')
})

it('identifies missing search credentials', () => {
  const data = overview()
  data.settings.searchEnabled = true
  expect(contactWorkStatus(data, false)).toContain('搜索密钥缺失')
})

it('supports all-day, daytime and overnight local work hours with exclusive end', () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 9, h, m).getTime()
  expect(withinWorkHours(DEFAULT_AGENT_SETTINGS, at(3))).toBe(true)
  const day = { ...DEFAULT_AGENT_SETTINGS, workHours: { start: '09:00', end: '18:00' } }
  expect(withinWorkHours(day, at(8, 59))).toBe(false)
  expect(withinWorkHours(day, at(9))).toBe(true)
  expect(withinWorkHours(day, at(18))).toBe(false)
  const night = { ...day, workHours: { start: '22:00', end: '06:00' } }
  expect(withinWorkHours(night, at(23))).toBe(true)
  expect(withinWorkHours(night, at(5, 59))).toBe(true)
  expect(withinWorkHours(night, at(6))).toBe(false)
  expect(withinWorkHours({ ...day, workHours: { start: '00:00', end: '00:00' } }, at(18))).toBe(true)
})
