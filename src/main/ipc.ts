import { ipcMain, type BrowserWindow } from 'electron'
import { registerDomain } from './ipc/registration'
import { registerSkillHandlers } from './skills'
import { createChatRuntime, type ChatRuntime } from './chat/runtime'
import { registerChatHandlers } from './ipc/chat'
import { registerSessionsHandlers } from './ipc/sessions'
import { registerMemoryHandlers } from './ipc/memory'
import { registerConfigHandlers } from './ipc/config'
import { registerCaptureHandlers } from './ipc/capture'
import { registerDesktopHandlers } from './ipc/desktop'
import { registerToolsHandlers } from './ipc/tools'

let runtime: ChatRuntime | undefined
let releaseHandlers: (() => void) | undefined

/** Composition only: domains own transport validation, ChatService owns request lifetime. */
export function registerIpcHandlers(mainWindow: BrowserWindow): () => void {
  if (releaseHandlers) throw new Error('IPC handlers are already registered')
  runtime = createChatRuntime(mainWindow)
  const releases: (() => void)[] = []
  const dispose = () => {
    for (const release of releases.splice(0).reverse()) release()
    if (releaseHandlers === dispose) releaseHandlers = undefined
  }
  try {
    for (const register of [registerDesktopHandlers, registerSessionsHandlers, registerMemoryHandlers,
      registerConfigHandlers, registerCaptureHandlers, registerToolsHandlers]) releases.push(register(mainWindow))
    releases.push(registerChatHandlers(runtime))
    releases.push(registerDomain(ipcMain, ipc => ipc.cleanup(registerSkillHandlers(mainWindow, ipc))))
    releaseHandlers = dispose
    return dispose
  } catch (error) { dispose(); throw error }
}

export async function closeChatHarness(): Promise<void> {
  try { await runtime?.service.close() } finally { releaseHandlers?.() }
}
