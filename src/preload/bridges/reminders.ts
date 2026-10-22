import type { AssistantMessageKind } from '../../shared/assistant-message'
import type { IpcRenderer } from 'electron'

export function createRemindersBridge(ipcRenderer: IpcRenderer) {

return {
  assistantRoutines: {
    history: (id: string, before?: number) => ipcRenderer.invoke('assistant-routines:history', id, before),
    onChanged: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('assistant-routines:changed', handler)
      return () => ipcRenderer.removeListener('assistant-routines:changed', handler)
    },
    list: () => ipcRenderer.invoke('assistant-routines:list'),
    save: (input: import('../../shared/assistant-routines').AssistantRoutineInput, id?: string, revision?: number) => ipcRenderer.invoke('assistant-routines:save', input, id, revision),
    remove: (id: string, revision: number) => ipcRenderer.invoke('assistant-routines:remove', id, revision)
  },

  reminders: {
    list: () => ipcRenderer.invoke('reminders:list'),
    schedule: (sessionId: string, messageId: string, minutes: number) => ipcRenderer.invoke('reminders:schedule', sessionId, messageId, minutes),
    cancel: (key: string) => ipcRenderer.invoke('reminders:cancel', key)
  },

  proactiveAppend: (content: string, timestamp?: number, kind?: AssistantMessageKind, deliveryId?: string) => ipcRenderer.invoke('proactive:append', content, timestamp, kind, deliveryId) as Promise<void>,

  getAssistantUnread: () => ipcRenderer.invoke('proactive:get-unread') as Promise<number>
}
}
