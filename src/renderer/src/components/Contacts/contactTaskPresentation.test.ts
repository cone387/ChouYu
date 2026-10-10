import { expect, it } from 'vitest'
import { contactTaskItems } from './contactTaskPresentation'
import { DEFAULT_AGENT_SETTINGS, type AgentOverview } from '../../../../shared/agents'

it('counts enabled waiting tasks and removes stale reply summaries after a real pause', () => {
  const data: AgentOverview = { settings: { ...DEFAULT_AGENT_SETTINGS, enabled: true }, revision: 1, callsToday: 0, nextAt: 0,
    topics: [{ id: 'ideas', characterId: 'alice', title: '持续评审', goal: '持续评审', constraints: '', revision: 1, status: 'researching', judgement: '', nextStep: '', reason: '用户暂停', openQuestions: '', createdAt: 1, updatedAt: 1 }],
    taskSchedule: { ideas: { nextAt: 1000, waitingForUpdates: true } }, focusTopicId: 'ideas', runs: [], reports: [], memories: [] }
  expect(contactTaskItems(data, [])[0]).toMatchObject({ enabled: true, status: '等待新内容' })
  data.topics[0].status = 'paused'
  data.runs = [{ topicId: 'ideas', status: 'waiting', question: '过期问题' }] as AgentOverview['runs']
  expect(contactTaskItems(data, [])[0]).toMatchObject({ enabled: false, running: false, status: '已暂停', summary: '用户暂停' })
})
