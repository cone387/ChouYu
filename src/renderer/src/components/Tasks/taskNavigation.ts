import type { TaskSource } from '../../../../shared/tasks'

export interface TaskConversionDraft { title: string; note: string; source: TaskSource }
export interface TaskNavigation { taskId?: string; draft?: TaskConversionDraft }
export function openTaskWorkspace(detail: TaskNavigation) {
  window.dispatchEvent(new CustomEvent<TaskNavigation>('chouyu:task-navigation', { detail }))
}
