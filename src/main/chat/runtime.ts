import type { BrowserWindow } from 'electron'
import { cancelContactChat, closeContactSpace, setContactHarnessPurge } from '../agents'
import { closeHarnessModules, purgeHarnessData, setHarnessCancellation } from '../harness/service'
import { ChatService } from './service'
import { executeChat } from './execution'
import { ChatToolApprovals } from './tool-approvals'

export function createChatRuntime(mainWindow: BrowserWindow) {
  const approvals = new ChatToolApprovals()
  const service = new ChatService({
    execute: execution => executeChat(execution, mainWindow, approvals),
    async close() { try { await closeContactSpace() } finally { await closeHarnessModules() } }
  })
  setHarnessCancellation(key => { service.cancelKey(key); return cancelContactChat(key) })
  setContactHarnessPurge(characterId => purgeHarnessData({ characterId }))
  return { service, approvals }
}
export type ChatRuntime = ReturnType<typeof createChatRuntime>
