import type { TasksStore } from '../tasks/store'
import type { TaskListOptions } from '../../shared/tasks'
import { bindOperations, type TaskDomain } from './contracts'

const operations = [
  'getTask', 'searchTasks', 'listTasks', 'createTask', 'updateTask', 'setChecklistItemDone', 'completeTask', 'reopenTask', 'deleteTask',
  'generateScheduledOccurrences', 'claimDueReminders',
  'exportBackup', 'validateBackup', 'restoreBackup', 'listTrash', 'restoreTrash', 'purgeTrash',
  'listProjects', 'listGroups', 'createGroup', 'renameGroup', 'deleteGroup', 'moveProject', 'createProject', 'renameProject',
  'favoriteProject', 'archiveProject', 'deleteProject', 'listViews', 'createView', 'updateView', 'deleteView',
  'listFields', 'createField', 'updateField', 'deleteField'
] as const
export type TodoCommands = Pick<TasksStore, typeof operations[number]>
export function createTodoDomain(store: TasksStore): TaskDomain<TodoCommands> {
  const commands = bindOperations(store, operations)
  return { id: 'todo', operations, assertOwner: owner => { if (owner !== 'user') throw new Error('用户待办归属不匹配。') },
    commands: () => commands, list: (_owner, query) => store.listTasks(query as TaskListOptions | undefined),
    read: ref => store.getTask(ref.id) }
}
