import type { TasksAPI, TasksReminderEvent } from '../../shared/tasks'
import type { IpcRenderer } from 'electron'

export function createTasksBridge(ipcRenderer: IpcRenderer) {

return {
  tasks: {
    trash: () => ipcRenderer.invoke('tasks:trash'),
    restoreTrash: id => ipcRenderer.invoke('tasks:restoreTrash', id),
    purgeTrash: id => ipcRenderer.invoke('tasks:purgeTrash', id),
    exportBackup: settings => ipcRenderer.invoke('tasks:exportBackup', settings),
    selectBackup: () => ipcRenderer.invoke('tasks:selectBackup'),
    restoreBackup: (token, settings) => ipcRenderer.invoke('tasks:restoreBackup', token, settings),
    list: options => ipcRenderer.invoke('tasks:list', options),
    statistics: range => ipcRenderer.invoke('tasks:statistics', range),
    get: id => ipcRenderer.invoke('tasks:get', id),
    onChanged: callback => {
      const listener = () => callback()
      ipcRenderer.on('tasks:changed', listener)
      return () => { ipcRenderer.removeListener('tasks:changed', listener) }
    },
    create: input => ipcRenderer.invoke('tasks:create', input),
    update: (id, patch) => ipcRenderer.invoke('tasks:update', id, patch),
    setChecklistItemDone: (id, itemId, done) => ipcRenderer.invoke('tasks:setChecklistItemDone', id, itemId, done),
    complete: id => ipcRenderer.invoke('tasks:complete', id),
    reopen: id => ipcRenderer.invoke('tasks:reopen', id),
    remove: id => ipcRenderer.invoke('tasks:delete', id),
    projects: () => ipcRenderer.invoke('tasks:projects'),
    groups: () => ipcRenderer.invoke('tasks:groups'),
    createGroup: name => ipcRenderer.invoke('tasks:createGroup', name),
    renameGroup: (id, name) => ipcRenderer.invoke('tasks:renameGroup', id, name),
    deleteGroup: (id, deleteContents) => ipcRenderer.invoke('tasks:deleteGroup', id, deleteContents),
    moveProject: (id, groupId) => ipcRenderer.invoke('tasks:moveProject', id, groupId),
    createProject: (name, groupId) => ipcRenderer.invoke('tasks:createProject', name, groupId),
    renameProject: (id, name) => ipcRenderer.invoke('tasks:renameProject', id, name),
    favoriteProject: (id, favorite) => ipcRenderer.invoke('tasks:favoriteProject', id, favorite),
    archiveProject: (id, archived) => ipcRenderer.invoke('tasks:archiveProject', id, archived),
    deleteProject: id => ipcRenderer.invoke('tasks:deleteProject', id),
    views: () => ipcRenderer.invoke('tasks:views'),
    createView: input => ipcRenderer.invoke('tasks:createView', input),
    updateView: (id, patch) => ipcRenderer.invoke('tasks:updateView', id, patch),
    deleteView: id => ipcRenderer.invoke('tasks:deleteView', id),
    fields: () => ipcRenderer.invoke('tasks:fields'),
    createField: input => ipcRenderer.invoke('tasks:createField', input),
    updateField: (id, patch) => ipcRenderer.invoke('tasks:updateField', id, patch),
    deleteField: id => ipcRenderer.invoke('tasks:deleteField', id),
    ready: () => { ipcRenderer.send('tasks:ready') },
    onTasksReminder: callback => {
      const handler = (_event: unknown, payload: TasksReminderEvent) => callback(payload)
      ipcRenderer.on('tasks:reminder', handler)
      return () => { ipcRenderer.removeListener('tasks:reminder', handler) }
    },
    onOpenTasksPanel: callback => {
      const handler = (_event: unknown, taskId?: unknown) => callback(typeof taskId === 'string' ? taskId : undefined)
      ipcRenderer.on('open-tasks-panel', handler)
      return () => { ipcRenderer.removeListener('open-tasks-panel', handler) }
    },
    onTasksStoreRebuilt: callback => {
      ipcRenderer.on('tasks:store-rebuilt', callback)
      return () => { ipcRenderer.removeListener('tasks:store-rebuilt', callback) }
    }
  } satisfies TasksAPI,

  contactTask: {
    request: (target: import('../../shared/contact-task-gateway').ContactTaskTarget, message: string) => ipcRenderer.invoke('contact-task:request', target, message),
    drafts: () => ipcRenderer.invoke('contact-task:drafts')
  }
}
}
