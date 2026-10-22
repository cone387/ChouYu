import type { StorageStatus } from '../../shared/storage'
import { createPendingEvent } from '../pending-event'
import type { AppConfig } from '../../shared/config'
import type { AIModelListResult } from '../../shared/ai'
import type { IpcRenderer } from 'electron'

export function createSessionsBridge(ipcRenderer: IpcRenderer) {


const openChatPanelEvent = createPendingEvent()

const openAssistantChatEvent = createPendingEvent()

ipcRenderer.on('open-chat-panel', () => openChatPanelEvent.emit())

ipcRenderer.on('open-assistant-chat', () => openAssistantChatEvent.emit())
return {
  onSessionsChanged: (callback: (reminderOnly?: boolean) => void) => {
    const handler = (_event: unknown, reminderOnly?: boolean) => callback(reminderOnly === true)
    ipcRenderer.on('sessions:changed', handler)
    return () => { ipcRenderer.removeListener('sessions:changed', handler) }
  },

  onAssistantUnread: (callback: (count: number) => void) => {
    const handler = (_e: unknown, count: number) => callback(count)
    ipcRenderer.on('assistant-unread-changed', handler)
    return () => { ipcRenderer.removeListener('assistant-unread-changed', handler) }
  },

  onOpenAssistantChat: (callback: () => void) => openAssistantChatEvent.subscribe(callback),

  onOpenChatPanel: (callback: () => void) => openChatPanelEvent.subscribe(callback),

  characters: {
    list: () => ipcRenderer.invoke('characters:list'),
    create: (draft: unknown) => ipcRenderer.invoke('characters:create', draft),
    update: (id: string, draft: unknown) => ipcRenderer.invoke('characters:update', id, draft),
    remove: (id: string) => ipcRenderer.invoke('characters:delete', id),
    fetchModels: (profileId: string) => ipcRenderer.invoke('characters:fetch-models', profileId) as Promise<AIModelListResult>,
    onChanged: (callback: () => void) => {
      ipcRenderer.on('characters:changed', callback)
      return () => { ipcRenderer.removeListener('characters:changed', callback) }
    }
  },

  db: {
    getStorageStatus: () => ipcRenderer.invoke('db:storage-status') as Promise<StorageStatus>,
    retrySave: () => ipcRenderer.invoke('db:retry-save') as Promise<StorageStatus>,
    dismissStorageNotice: () => ipcRenderer.invoke('db:dismiss-storage-notice') as Promise<StorageStatus>,
    openDataDirectory: () => ipcRenderer.invoke('db:open-data-directory') as Promise<string>,
    onStorageStatus: (callback: (status: StorageStatus) => void) => {
      const handler = (_event: unknown, status: StorageStatus) => callback(status)
      ipcRenderer.on('db:storage-status', handler)
      return () => { ipcRenderer.removeListener('db:storage-status', handler) }
    },
    getConfig: () => ipcRenderer.invoke('db:get-config'),
    saveConfig: (cfg: Partial<AppConfig>) => ipcRenderer.invoke('db:save-config', cfg) as Promise<AppConfig>,
    getMessages: () => ipcRenderer.invoke('db:get-messages'),
    saveMessages: (msgs: unknown[]) => ipcRenderer.invoke('db:save-messages', msgs),
    clearMessages: () => ipcRenderer.invoke('db:clear-messages'),
    getSessionWorkspace: () => ipcRenderer.invoke('db:get-session-workspace'),
    searchSessions: (query: string) => ipcRenderer.invoke('db:search-sessions', query),
    createSession: (title?: string, characterId?: string) => ipcRenderer.invoke('db:create-session', title, characterId),
    selectSession: (id: string) => ipcRenderer.invoke('db:select-session', id),
    renameSession: (id: string, title: string) => ipcRenderer.invoke('db:rename-session', id, title),
    deleteSession: (id: string) => ipcRenderer.invoke('db:delete-session', id),
    saveSessionMessages: (id: string, msgs: unknown[], readMessageId?: string) => ipcRenderer.invoke('db:save-session-messages', id, msgs, readMessageId),
    markSessionRead: (id: string, messageId?: string) => ipcRenderer.invoke('db:mark-session-read', id, messageId),
    exportSession: (id: string) => ipcRenderer.invoke('db:export-session', id),
    getState: (key: string) => ipcRenderer.invoke('db:get-state', key),
    setState: (key: string, value: string) => ipcRenderer.invoke('db:set-state', key, value)
  }
}
}
