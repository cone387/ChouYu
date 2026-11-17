import type { ReminderSource, ReminderSourceState } from '../../shared/reminder-followups'
import type { TaskReminderRef } from '../../shared/reminders'
import type { TodoCommands } from '../task-center/todo-domain'

type TodoSource = Pick<TodoCommands, 'getTask' | 'listProjects' | 'completeTask' | 'setChecklistItemDone'>
export function resolveTodoReminder(store: TodoSource, ref: TaskReminderRef): ReminderSourceState {
  const task = store.getTask(ref.taskId)
  if (!task) return { status: 'obsolete', reason: '任务已删除' }
  if (task.status !== 'open') return { status: 'processed', reason: '任务已完成' }
  if (task.projectId && store.listProjects().some(project => project.id === task.projectId && project.archivedAt)) return { status: 'obsolete', reason: '清单已归档' }
  if (ref.checklistId) {
    const item = task.checklist?.find(item => item.id === ref.checklistId)
    if (!item) return { status: 'obsolete', reason: '子项已删除' }
    if (item.done) return { status: 'processed', reason: '子项已完成' }
    return item.reminders?.some(reminder => reminder.at === ref.reminderAt) ? { status: 'pending', label: `${task.title} · ${item.title}` } : { status: 'obsolete', reason: '子项提醒已改期或移除' }
  }
  return task.reminders?.some(reminder => reminder.at === ref.reminderAt) ? { status: 'pending', label: task.title } : { status: 'obsolete', reason: '任务提醒已改期或移除' }
}
export function finishTodoReminder(store: TodoSource, ref: TaskReminderRef): void {
  const state = resolveTodoReminder(store, ref)
  if (state.status === 'processed') return
  if (state.status !== 'pending') throw new Error(state.reason ?? '提醒已失效。')
  if (ref.checklistId) store.setChecklistItemDone(ref.taskId, ref.checklistId, true)
  else store.completeTask(ref.taskId)
}
export function resolveContactReminder(source: ReminderSource, ports: {
  interaction(id: string): { status: string; result?: string; kind?: string; currentState?: string } | undefined
  task(id: string): { status: string } | undefined
  run(id: string): { status: string } | undefined
}): ReminderSourceState {
  if (source.kind === 'interaction') {
    const interaction = ports.interaction(source.interactionId)
    if (!interaction) return { status: 'obsolete', reason: '原处理事项已移除' }
    if (interaction.kind === 'retry' && interaction.currentState) {
      if (interaction.currentState === 'completed') return { status: 'processed', reason: '后续尝试已实际完成' }
      if (['queued', 'running', 'interrupted'].includes(interaction.currentState)) return { status: 'pending' }
      return { status: 'obsolete', reason: interaction.result ?? '原故障已由新的任务状态或处理事项接替' }
    }
    if (interaction.status === 'resolved') return { status: 'processed', reason: interaction.result ?? '原事项已处理' }
    if (interaction.status === 'obsolete') return { status: 'obsolete', reason: interaction.result ?? '原事项已失效' }
    return { status: 'pending' }
  }
  if (source.kind === 'contact-task') {
    const task = ports.task(source.topicId)
    if (!task) return { status: 'obsolete', reason: '原任务已删除' }
    if (!source.actionable) return { status: 'pending' }
    if (['paused', 'abandoned'].includes(task.status)) return { status: 'obsolete', reason: '原任务已暂停或放弃' }
    const run = ports.run(source.runId)
    if (!run) return { status: 'obsolete', reason: '原轮次已移除' }
    if (run.status === 'completed') return { status: 'processed', reason: '原轮次已完成' }
    if (!['waiting', 'failed'].includes(run.status)) return { status: 'obsolete', reason: '原任务已进入新的执行状态' }
  }
  return { status: 'pending' }
}
