import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, type AgentOverview, type AgentRun } from '../../../../shared/agents'
import { workLogActivity } from './workLogActivity'

const run: AgentRun = { id: 'run', characterId: 'contact', topicId: 'topic', revision: 1, status: 'completed', createdAt: 1000, updatedAt: 2000, question: '', answer: '', summary: '', error: '' }
const overview: AgentOverview = {
  settings: { ...DEFAULT_AGENT_SETTINGS, enabled: true }, revision: 1, nextAt: 65000, callsToday: 0,
  runs: [run], memories: [], reports: [], focusTopicId: 'topic',
  topics: [{ id: 'topic', characterId: 'contact', revision: 1, status: 'researching', title: '实验', goal: '', constraints: '', judgement: '', openQuestions: '', nextStep: '', reason: '', createdAt: 1000, updatedAt: 2000 }]
}
describe('work log activity', () => {
  it('counts down between continuous rounds instead of presenting a completed round as stopped', () => {
    expect(workLogActivity(run, overview, undefined, 5000, '').text).toContain('1 分 0 秒')
    expect(workLogActivity(run, overview, undefined, 6000, '').text).toContain('0 分 59 秒')
    expect(workLogActivity(run, overview, undefined, 65000, '').text).toContain('等待调度')
  })
  it('keeps response waits moving without pretending to execute work', () => {
    expect(workLogActivity({ ...run, status: 'waiting' }, overview, undefined, 5000, '')).toEqual({ label: 'WAITING', moving: true, text: '等待你的回复 · 已等待 3 秒' })
  })
  it('stops for paused topics, disabled work, and expired deadlines', () => {
    for (const data of [
      { ...overview, settings: { ...overview.settings, enabled: false } },
      { ...overview, settings: { ...overview.settings, workUntil: 4000 } },
      { ...overview, topics: [{ ...overview.topics[0], status: 'paused' as const }] },
      { ...overview, focusTopicId: 'another-topic' }
    ]) expect(workLogActivity(run, data, undefined, 5000, '').moving).toBe(false)
  })
  it('shows budget waits and disconnected logs truthfully', () => {
    expect(workLogActivity(run, { ...overview, callsToday: 8 }, undefined, 5000, '').text).toContain('额度不足')
    expect(workLogActivity({ ...run, status: 'running' }, overview, undefined, 5000, '断线').label).toBe('RECONNECTING')
  })
})
