import { contextBridge, ipcRenderer } from 'electron'
import { createUsageBridge } from './bridges/usage'
import { createSkillsBridge } from './bridges/skills'
import { createAgentsBridge } from './bridges/agents'
import { createJournalBridge } from './bridges/journal'
import { createTasksBridge } from './bridges/tasks'
import { createCaptureBridge } from './bridges/capture'
import { createDesktopBridge } from './bridges/desktop'
import { createConfigBridge } from './bridges/config'
import { createChatBridge } from './bridges/chat'
import { createToolsBridge } from './bridges/tools'
import { createMemoryBridge } from './bridges/memory'
import { createRemindersBridge } from './bridges/reminders'
import { createSessionsBridge } from './bridges/sessions'
import { createPluginsBridge } from './bridges/plugins'

const api = {
  ...createUsageBridge(ipcRenderer),
  ...createSkillsBridge(ipcRenderer),
  ...createAgentsBridge(ipcRenderer),
  ...createJournalBridge(ipcRenderer),
  ...createTasksBridge(ipcRenderer),
  ...createCaptureBridge(ipcRenderer),
  ...createDesktopBridge(ipcRenderer),
  ...createConfigBridge(ipcRenderer),
  ...createChatBridge(ipcRenderer),
  ...createToolsBridge(ipcRenderer),
  ...createMemoryBridge(ipcRenderer),
  ...createRemindersBridge(ipcRenderer),
  ...createSessionsBridge(ipcRenderer),
  ...createPluginsBridge(ipcRenderer),
}

contextBridge.exposeInMainWorld('electronAPI', api)
