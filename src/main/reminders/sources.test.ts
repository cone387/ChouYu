import { expect, it } from 'vitest'
import { resolveTodoReminder, finishTodoReminder, resolveContactReminder } from './source-state'

const ref = { taskId: 't', reminderAt: 10 }
function todo() {
  const task = { id: 't', title: '任务', status: 'open', projectId: 'p', reminders: [{ at: 10 }], checklist: [{ id: 'c', title: '子项', done: false, reminders: [{ at: 10 }] }] }
  let archivedAt: number | null = null, completions = 0
  const store = { getTask: () => task, listProjects: () => [{ id: 'p', archivedAt }], completeTask: () => { task.status = 'done'; completions++ }, setChecklistItemDone: (_task: string, _item: string, done: boolean) => { task.checklist[0].done = done } }
  return { task, store: store as any, archive: () => { archivedAt = 1 }, completions: () => completions }
}
it('uses actual todo and child state and completes only the referenced item', () => {
  const f = todo()
  expect(resolveTodoReminder(f.store, ref)).toMatchObject({ status: 'pending', label: '任务' })
  finishTodoReminder(f.store, { ...ref, checklistId: 'c' })
  expect(resolveTodoReminder(f.store, { ...ref, checklistId: 'c' }).status).toBe('processed')
  expect(f.task.status).toBe('open')
  finishTodoReminder(f.store, ref); finishTodoReminder(f.store, ref)
  expect(f.completions()).toBe(1); expect(resolveTodoReminder(f.store, ref).status).toBe('processed')
})
it('does not complete an archived or rescheduled task', () => {
  const f = todo(); f.archive()
  expect(resolveTodoReminder(f.store, ref).status).toBe('obsolete')
  expect(() => finishTodoReminder(f.store, ref)).toThrow()
  const g = todo(); g.task.reminders = [{ at: 20 }]
  expect(resolveTodoReminder(g.store, ref).status).toBe('obsolete')
})
it('defers to the actual interaction and never treats a source read error as deletion', () => {
  let status = 'pending'
  const ports = { interaction: () => ({ status }), task: () => undefined, run: () => undefined }
  const source = { kind: 'interaction' as const, interactionId: 'q' }
  expect(resolveContactReminder(source, ports).status).toBe('pending')
  status = 'executing'; expect(resolveContactReminder(source, ports).status).toBe('pending')
  status = 'resolved'; expect(resolveContactReminder(source, ports).status).toBe('processed')
  status = 'obsolete'; expect(resolveContactReminder(source, ports).status).toBe('obsolete')
  expect(() => resolveContactReminder(source, { ...ports, interaction: () => { throw new Error('storage') } })).toThrow('storage')
})
it('keeps delivered content pending on task completion but retires deleted sources', () => {
  const source = { kind: 'contact-task' as const, topicId: 't', runId: 'r', actionable: false }
  const ports = { interaction: () => undefined, task: () => ({ status: 'completed' }), run: () => ({ status: 'completed' }) }
  expect(resolveContactReminder(source, ports).status).toBe('pending')
  expect(resolveContactReminder(source, { ...ports, task: () => undefined }).status).toBe('obsolete')
  expect(resolveContactReminder({ ...source, actionable: true }, ports).status).toBe('processed')
})
