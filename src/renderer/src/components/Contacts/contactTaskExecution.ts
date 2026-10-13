import type { AgentOverview, AgentTopic } from '../../../../shared/agents'
import { taskState } from '../../../../shared/task-state'

/** The same single-task execution semantics serve detail and chat controls. */
export function contactTaskExecution(data: AgentOverview, topic: AgentTopic) {
  const ended = ['completed', 'abandoned'].includes(topic.status) || Boolean(data.taskSchedule?.[topic.id]?.finishedAt)
  const available = !ended && topic.status !== 'paused'
  const run = available ? data.runs.find(run => run.topicId === topic.id && ['queued', 'running', 'waiting', 'interrupted'].includes(run.status)) : undefined
  const queued = data.queuedTopicIds?.includes(topic.id)
  const canPause = Boolean(available && (run || queued || data.settings.enabled && (data.focusTopicId === topic.id || data.taskSchedule?.[topic.id])))
  const state = taskState(data, topic)
  const latestRun = data.runs.find(run => run.topicId === topic.id)
  const action = latestRun?.status === 'failed' && latestRun.revisionScope === 'presentation' ? 'inspect'
    : ended ? undefined : run?.status === 'waiting' ? 'reply' : canPause ? 'pause' : 'continue'
  return { topic, state, run, latestRun, canPause, action }
}

export function currentTaskChoices(data: AgentOverview) {
  const priority = (code: string) => ['running', 'waiting', 'queued', 'interrupted'].indexOf(code)
  return data.topics.filter(topic => !['completed', 'abandoned'].includes(topic.status)
    && (topic.status !== 'planned' || topic.calendar || topic.id === data.focusTopicId || data.queuedTopicIds?.includes(topic.id) || data.runs.some(run => run.topicId === topic.id)))
    .map(topic => contactTaskExecution(data, topic))
    .sort((a, b) => (priority(a.state.code) < 0 ? 4 : priority(a.state.code)) - (priority(b.state.code) < 0 ? 4 : priority(b.state.code))
      || Number(b.topic.id === data.focusTopicId) - Number(a.topic.id === data.focusTopicId))
}

export function selectCurrentTask(choices: ReturnType<typeof currentTaskChoices>, selected: string) {
  return selected ? choices.find(item => item.topic.id === selected) : choices[0]
}
