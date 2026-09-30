import { expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, type AgentOverview, type AgentTopic, type AgentTopicMetrics } from './agents'
import { contactWorkStatus, taskWorkStatus } from './work-settings'

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

it('gives an expired arrangement a recovery action and identifies missing search credentials', () => {
  const data = overview()
  data.settings.workUntil = 100
  expect(contactWorkStatus(data, true, 200)).toContain('取消或延长')
  data.settings.workUntil = undefined
  data.settings.searchEnabled = true
  expect(contactWorkStatus(data, false)).toContain('搜索密钥缺失')
})
