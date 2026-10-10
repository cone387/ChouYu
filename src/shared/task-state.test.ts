import { expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, type AgentOverview, type AgentTopic } from './agents'
import { taskState } from './task-state'

const topic: AgentTopic = { id: 'ideas', characterId: 'alice', title: '持续生产 idea', goal: '全天持续生产 idea', constraints: '', revision: 1, status: 'researching', judgement: '', reason: '', nextStep: '', openQuestions: '', createdAt: 1, updatedAt: 1 }
function data(): AgentOverview {
  return { settings: { ...DEFAULT_AGENT_SETTINGS, enabled: true, dailyCalls: 100 }, revision: 1, callsToday: 0, nextAt: 2000, focusTopicId: topic.id, topics: [topic], runs: [], reports: [], memories: [], taskSchedule: { ideas: { nextAt: 2000 } } }
}
it('distinguishes a completed round, waiting for updates and executing without declaring the task incomplete', () => {
  const d = data()
  d.runs = [{ topicId: topic.id, status: 'completed' }] as AgentOverview['runs']
  expect(taskState(d, topic, 1000).label).toBe('等待下一轮')
  d.taskSchedule!.ideas.waitingForUpdates = true
  expect(taskState(d, topic, 1000).label).toBe('等待新内容')
  d.runs = [{ topicId: topic.id, status: 'running' }] as AgentOverview['runs']
  expect(taskState(d, topic, 1000).label).toBe('正在推进')
})
it('gives real pauses and blocking conditions precedence over automatic work', () => {
  const d = data()
  d.runs = [{ topicId: topic.id, status: 'waiting', question: '需要方向' }] as AgentOverview['runs']
  expect(taskState(d, { ...topic, status: 'paused', reason: '用户暂停' }, 1000)).toMatchObject({ label: '已暂停', description: '用户暂停' })
  expect(taskState(d, topic, 1000).label).toBe('等你回复')
  d.runs = []; d.callsToday = 100
  expect(taskState(d, topic, 1000).label).toBe('等待额度恢复')
  d.callsToday = 0; d.taskFailures = { ideas: { failures: 3, retryAt: 3000 } }
  expect(taskState(d, topic, 1000).label).toBe('等待重试')
})
it('does not promise autonomous work for unscheduled or manual tasks, or finish a task after a successful round', () => {
  const d = data()
  d.focusTopicId = null; d.taskSchedule = {}
  expect(taskState(d, topic, 1000).label).toBe('待安排推进')
  d.settings.enabled = false
  expect(taskState(d, topic, 1000).label).toBe('按需推进')
  expect(taskState(d, { ...topic, status: 'completed' }, 1000).label).toBe('已结束')
})
it('distinguishes an insufficient daily ceiling and a real Token reservation block from ordinary waiting', () => {
  const d = data()
  d.queuedTopicIds = [topic.id]; d.settings.dailyCalls = 2
  expect(taskState(d, topic, 1000)).toMatchObject({ code: 'daily-limit', label: '等待调整额度' })
  d.settings.dailyCalls = 100; d.settings.dailyTokenLimit = 1000
  d.taskResources = { ideas: { callsNeeded: 1, tokensNeeded: 1200 } }
  expect(taskState(d, topic, 1000).description).toContain('次日也无法执行')
  d.settings.dailyTokenLimit = 2000; d.tokenUsage = { today: 1000, estimated: 0, tasks: {} }
  expect(taskState(d, topic, 1000).code).toBe('daily-budget')
})
