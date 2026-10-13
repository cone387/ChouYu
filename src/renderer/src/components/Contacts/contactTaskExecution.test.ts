import { expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, type AgentOverview } from '../../../../shared/agents'
import { contactTaskExecution, currentTaskChoices, selectCurrentTask } from './contactTaskExecution'

const fixture = (): AgentOverview => ({ settings: { ...DEFAULT_AGENT_SETTINGS, enabled: true }, revision: 1, callsToday: 0, nextAt: 0, runs: [], reports: [], memories: [],
  topics: ['a', 'b'].map(id => ({ id, characterId: 'alice', title: id, goal: id, constraints: '', status: 'researching', revision: 1, judgement: '', nextStep: '', reason: '', openQuestions: '', createdAt: 1, updatedAt: 1 })), focusTopicId: 'a' })

it('prioritizes the actual running task and keeps an explicit selection after pausing', () => {
  const data = fixture()
  data.runs = [{ id: 'run-b', topicId: 'b', status: 'running' }] as AgentOverview['runs']
  const choices = currentTaskChoices(data)
  expect(selectCurrentTask(choices, '')?.topic.id).toBe('b')
  expect(selectCurrentTask(choices, 'a')?.topic.id).toBe('a')
  data.topics[1].status = 'paused'
  expect(selectCurrentTask(currentTaskChoices(data), 'b')).toMatchObject({ topic: { id: 'b' }, action: 'continue', state: { code: 'paused' } })
})

it('distinguishes waiting questions, queued work, paused and ended tasks', () => {
  const data = fixture(), topic = data.topics[0]
  data.runs = [{ id: 'waiting', topicId: 'a', status: 'waiting', question: '面向谁？' }] as AgentOverview['runs']
  expect(contactTaskExecution(data, topic)).toMatchObject({ canPause: true, action: 'reply', run: { id: 'waiting' } })
  data.runs[0].status = 'queued'
  expect(contactTaskExecution(data, topic)).toMatchObject({ canPause: true, action: 'pause' })
  topic.status = 'paused'
  expect(contactTaskExecution(data, topic)).toMatchObject({ canPause: false, action: 'continue' })
  topic.status = 'completed'
  expect(currentTaskChoices(data).some(item => item.topic.id === 'a')).toBe(false)
})

it('does not offer a guessed task after deletion, and omits never-started unrelated drafts', () => {
  const data = fixture()
  data.topics[1].status = 'planned'
  expect(currentTaskChoices(data).map(item => item.topic.id)).toEqual(['a'])
  expect(selectCurrentTask(currentTaskChoices(data), 'deleted')).toBeUndefined()
})
it('includes future calendar tasks and does not offer to continue a finished once schedule', () => {
  const data = fixture(), topic = data.topics[1]
  topic.status = 'planned'
  topic.calendar = { cadence: 'once', date: '2026-12-31', times: ['09:00'] }
  data.taskSchedule = { b: { calendar: topic.calendar, nextAt: Date.now() + 10000 } }
  expect(currentTaskChoices(data).some(item => item.topic.id === 'b')).toBe(true)
  data.taskSchedule.b.finishedAt = Date.now()
  expect(contactTaskExecution(data, topic)).toMatchObject({ canPause: false, action: undefined })
})
it('opens the original failed presentation record instead of continuing prose', () => {
  const data = fixture(), topic = data.topics[0]
  data.settings.enabled = false
  data.runs = [{ id: 'style-failed', topicId: 'a', status: 'failed', revisionScope: 'presentation' }] as AgentOverview['runs']
  expect(contactTaskExecution(data, topic)).toMatchObject({ action: 'inspect', latestRun: { id: 'style-failed' } })
  topic.status = 'paused'
  expect(contactTaskExecution(data, topic).action).toBe('inspect')
  topic.status = 'completed'
  expect(contactTaskExecution(data, topic).action).toBe('inspect')
  expect(currentTaskChoices(data).some(item => item.topic.id === topic.id)).toBe(false)
  topic.status = 'abandoned'
  expect(contactTaskExecution(data, topic).action).toBe('inspect')
})
