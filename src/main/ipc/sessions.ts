import { acknowledgeHarnessMessages, purgeHarnessData } from '../harness/service'
import { contactSkillLibrary } from '../skills'
import { appendCompanionBriefing } from '../assistant-routines'
import { normalizeAssistantMessageKind } from '../../shared/assistant-message'
import { BrowserWindow, dialog, app, shell } from 'electron'
import { notifyJournalConfig } from '../journal'
import fs from 'fs'
import { formatSessionMarkdown } from '../../shared/sessions'
import { removeContactAgent } from '../agents'
import { setTrayUnread } from '../tray'
import { getStorageStatus, onStorageStatus, dismissStorageNotice, flushDatabase, getConfig, getCharacter, listCharacters, createCharacter, updateCharacter, deleteCharacter, getMessages, saveMessages, clearMessages, getSessionWorkspace, searchSessions, getSession, createChatSession, selectChatSession, renameChatSession, deleteChatSession, saveSessionMessages, appendAssistantMessage, getAssistantUnreadCount, getAssistantUnreadPreview, markSessionRead } from '../database'
import { ipcMain } from 'electron'
import { registerDomain } from './registration'

export function registerSessionsHandlers(mainWindow: BrowserWindow) {
  return registerDomain(ipcMain, ipc => {  
    const unsubscribeStorage = onStorageStatus((status) => {
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send('db:storage-status', status)
    })
  
    mainWindow.once('closed', unsubscribeStorage)
    ipc.cleanup(() => { mainWindow.removeListener('closed', unsubscribeStorage); unsubscribeStorage() })
  
    ipc.handle('db:storage-status', () => getStorageStatus())
  
    ipc.handle('db:retry-save', () => {
      const status = flushDatabase()
      if (!status.error) { mainWindow.webContents.send('config:changed', getConfig()); notifyJournalConfig(getConfig()) }
      return status
    })
  
    ipc.handle('db:dismiss-storage-notice', () => dismissStorageNotice())
  
    ipc.handle('db:open-data-directory', () => shell.openPath(app.getPath('userData')))
  
    ipc.handle('db:get-messages', () => getMessages())
  
    ipc.handle('db:save-messages', (_event, messages) => saveMessages(messages))
  
    ipc.handle('db:clear-messages', () => clearMessages())
  
    ipc.handle('db:get-session-workspace', () => getSessionWorkspace())
  
    ipc.handle('db:search-sessions', (_event, query: string) => {
      if (typeof query !== 'string' || query.length > 500) throw new Error('Invalid search query')
      return searchSessions(query)
    })
  
    ipc.handle('db:create-session', (_event, title?: string, characterId?: string) =>
      createChatSession(typeof title === 'string' ? title.slice(0, 80) : undefined, characterId))

    const notifyCharactersChanged = () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('characters:changed')
    }

    const notifyAssistantUnread = () => {
      const count = getAssistantUnreadCount()
      setTrayUnread(count, getAssistantUnreadPreview())
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('assistant-unread-changed', count)
    }

    ipc.handle('proactive:append', async (_event, content: unknown, timestamp?: unknown, kind?: unknown, deliveryId?: unknown) => {
      if (typeof content !== 'string' || !content.trim() || content.length > 20_000) throw new Error('Invalid proactive content')
      const at = typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : undefined
      if (deliveryId !== undefined && (typeof deliveryId !== 'string' || !deliveryId || deliveryId.length > 200)) throw new Error('Invalid delivery id')
      if ((kind === 'greeting' || kind === 'return') && typeof deliveryId === 'string') {
        await appendCompanionBriefing(kind, deliveryId)
        return
      }
      appendAssistantMessage(content, at, normalizeAssistantMessageKind(kind) ?? 'notification', typeof deliveryId === 'string' ? { receiptIds: [`companion:${deliveryId}`] } : undefined)
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sessions:changed', true)
      notifyAssistantUnread()
    })
  
    ipc.handle('proactive:get-unread', () => getAssistantUnreadCount())
  
    ipc.handle('db:mark-session-read', (_event, id: string, messageId?: string) => {
      if (typeof id !== 'string' || !id || id.length > 128) throw new Error('Invalid session id')
      const workspace = markSessionRead(id, messageId)
      notifyAssistantUnread()
      return workspace
    })

    ipc.handle('characters:list', () => listCharacters())
  
    ipc.handle('characters:create', (_event, draft: unknown) => {
      const result = createCharacter(draft)
      notifyCharactersChanged()
      return result
    })
  
    ipc.handle('characters:update', (_event, id: string, draft: unknown) => {
      const result = updateCharacter(id, draft)
      notifyCharactersChanged()
      if (result.builtIn) {
        const config = getConfig()
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('config:changed', config)
        notifyJournalConfig(config)
      }
      return result
    })
  
    ipc.handle('characters:delete', async (_event, id: string) => {
      const character = getCharacter(id)
      if(character&&!character.builtIn)await purgeHarnessData({characterId:id})
      if (character && !character.builtIn) await removeContactAgent(id)
      const workspace = deleteCharacter(id)
      contactSkillLibrary().removeContact(id)
      notifyCharactersChanged()
      notifyAssistantUnread()
      return workspace
    })
  
    ipc.handle('db:select-session', (_event, id: string) => {
      if (typeof id !== 'string' || !id || id.length > 128) throw new Error('Invalid session id')
      const workspace = selectChatSession(id)
      notifyAssistantUnread()
      return workspace
    })
  
    ipc.handle('db:rename-session', (_event, id: string, title: string) => {
      if (typeof id !== 'string' || !id || id.length > 128) throw new Error('Invalid session id')
      if (typeof title !== 'string') throw new Error('Invalid session title')
      return renameChatSession(id, title.slice(0, 80))
    })
  
    ipc.handle('db:delete-session', async (_event, id: string) => {
      if (typeof id !== 'string' || !id || id.length > 128) throw new Error('Invalid session id')
      const session=getSession(id);if(session)await purgeHarnessData({characterId:session.characterId,sessionId:id})
      const workspace = deleteChatSession(id)
      notifyAssistantUnread()
      return workspace
    })
  
    ipc.handle('db:save-session-messages', async (_event, id: string, messages, readMessageId?: string) => {
      if (typeof id !== 'string' || !id || id.length > 128) throw new Error('Invalid session id')
      if (!Array.isArray(messages)) throw new Error('Invalid session messages')
      if (readMessageId !== undefined && (typeof readMessageId !== 'string' || !readMessageId || readMessageId.length > 128)) throw new Error('Invalid read message id')
      if(!messages.length){const session=getSession(id);if(session)await purgeHarnessData({characterId:session.characterId,sessionId:id})}
      const workspace = saveSessionMessages(id, messages, readMessageId)
      await acknowledgeHarnessMessages(id)
      notifyAssistantUnread()
      return workspace
    })
  
    ipc.handle('db:export-session', async (_event, id: string) => {
      if (typeof id !== 'string' || !id || id.length > 128) throw new Error('Invalid session id')
      const session = getSession(id)
      if (!session) throw new Error('会话不存在或已被删除。')
      const safeTitle = session.title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 60) || 'ChouYu 对话'
      const result = await dialog.showSaveDialog(mainWindow, {
        title: '导出对话',
        defaultPath: `${safeTitle}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      })
      if (result.canceled || !result.filePath) return { ok: false, canceled: true }
      await fs.promises.writeFile(result.filePath, formatSessionMarkdown(session), 'utf-8')
      return { ok: true, canceled: false, filePath: result.filePath }
    })
  })
}
