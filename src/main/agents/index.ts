import { app, BrowserWindow, ipcMain, utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import { appendAgentNotice, getCharacter, getConfig, getSession, getSessions, listCharacters, getState, setState } from '../database'
import type { AgentNotice } from '../../shared/agents'
import { createContactTools } from './tools'
import { getRegisteredTool, registerTool } from '../tools/registry'
import { ASSISTANT_CHARACTER_ID, resolveCharacterConfig } from '../../shared/characters'
import type { AgentIdentity } from './service'

let child: UtilityProcess | undefined
let starting: Promise<void> | undefined
let closing = false
let failures = 0
let sequence = 0
let syncTimer: ReturnType<typeof setInterval> | undefined
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
let delivering = false
const dirty = new Set<string>()
async function deliver(id: string) {
  dirty.add(id)
  if (delivering || starting || closing) return
  delivering = true
  try {
    while (dirty.size && child && !closing) {
      const characterId = dirty.values().next().value!
      dirty.delete(characterId)
      if (!getCharacter(characterId)) continue
      try {
        const notices = await rpc('notices', characterId) as AgentNotice[]
        for (const notice of notices) {
          appendAgentNotice(notice)
          for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('sessions:changed')
          await rpc('ackNotice', characterId, [notice.id])
        }
      } catch { /* Durable outbox is retried by the sync timer after storage/process recovery. */ }
    }
  } finally { delivering = false }
}
function broadcastChanged(characterId: string) {
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('agents:changed', characterId)
  void deliver(characterId)
}
function rpc(method: string, id = '', args: unknown[] = []): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!child) { reject(new Error('Agent 执行进程不可用，请稍后重试。')); return }
    const requestId = ++sequence
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Agent 执行进程响应超时。')); child?.kill() }, 15000)
    pending.set(requestId, { resolve, reject, timer }); child.postMessage({ requestId, method, id, args })
  })
}
function identities(): AgentIdentity[] {
  const config = getConfig(), sessions = getSessions()
  return listCharacters().filter(c => c.id !== ASSISTANT_CHARACTER_ID).map(character => {
    const resolved = resolveCharacterConfig(character, config)
    const conversation = sessions.filter(s => s.characterId === character.id).slice(0, 2).flatMap(s => getSession(s.id)?.messages.slice(-8).map(m => `${m.role}: ${m.content.slice(0, 1500)}`) || []).join('\n').slice(0, 8000)
    return { id: character.id, soul: character.soulMd || config.soulMd, conversation, searchKey: getState(`agent-search:${character.id}:api_key`) || '', config: resolved.ok ? { provider: resolved.config.provider, baseUrl: resolved.config.baseUrl, apiKey: resolved.config.apiKey, model: resolved.config.model, thinkingDisabledModels: config.thinkingDisabledModels } : null }
  })
}
async function ensure() {
  if (closing) throw new Error('应用正在退出。')
  if (starting) return starting
  if (child) return
  starting = (async () => {
    const process = utilityProcess.fork(join(__dirname, 'agent-worker.js'), [], {
      serviceName: 'ChouYu Contact Agents', stdio: 'pipe',
      env: { ...globalThis.process.env, LANGSMITH_TRACING: 'false', LANGCHAIN_TRACING_V2: 'false', LANGCHAIN_TRACING: 'false' }
    })
    child = process
    process.stdout?.resume()
    if (globalThis.process.env.CHOUYU_SMOKE_TEST === '1') process.stderr?.on('data', chunk => console.error('CHOUYU_AGENT_WORKER', String(chunk)))
    else process.stderr?.resume()
    const born = Date.now()
    process.on('message', message => {
      if (message.changed) { broadcastChanged(message.changed); return }
      const request = pending.get(message.requestId)
      if (!request) return
      clearTimeout(request.timer); pending.delete(message.requestId)
      if (message.error) request.reject(new Error(message.error)); else request.resolve(message.result)
    })
    process.on('exit', () => {
      if (child !== process) return
      child = undefined
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Agent 执行进程已退出，未完成工作将在恢复后继续。')) }; pending.clear()
      if (!closing) {
        failures = Date.now() - born > 60000 ? 1 : failures + 1
        if (failures <= 3) setTimeout(() => { void ensure().catch(() => {}) }, failures * 2000)
      }
    })
    try {
      await rpc('init', '', [join(app.getPath('userData'), 'contact-agents')])
      const current = identities()
      await rpc('sync', '', [current])
      // In-flight UI reads may have been rejected during the exit. A restored
      // waiting run emits no new graph event, so explicitly invalidate the UI.
      for (const identity of current) broadcastChanged(identity.id)
    }
    catch (error) { process.kill(); throw error }
  })().finally(() => { starting = undefined; for (const id of dirty) void deliver(id) })
  return starting
}
export async function agentContext(characterId: string) { await ensure(); return await rpc('context', characterId) as string }
export async function removeContactAgent(characterId: string) { setState(`agent-search:${characterId}:api_key`, ''); await ensure(); await rpc('remove', characterId) }
export async function restartAgentsForSmoke() {
  if (process.env.CHOUYU_SMOKE_TEST !== '1') throw new Error('Smoke only')
  const previous = child
  if (previous) await new Promise<void>(resolve => { previous.once('exit', () => resolve()); previous.kill() })
  await ensure()
}
export function initializeAgents() {
  ipcMain.handle('agents:searchCredential', async (_event, id: string, key?: string) => {
    if (typeof id !== 'string' || !getCharacter(id) || id === ASSISTANT_CHARACTER_ID) throw new Error('联系人不存在。')
    if (key !== undefined) {
      if (typeof key !== 'string' || key.length > 8192 || /[\r\n]/.test(key)) throw new Error('搜索密钥无效。')
      setState(`agent-search:${id}:api_key`, key.trim())
      await ensure(); await rpc('sync', '', [identities()]); broadcastChanged(id)
    }
    return { configured: Boolean(getState(`agent-search:${id}:api_key`)) }
  })
  for (const tool of createContactTools({
    owner: sessionId => sessionId ? getSession(sessionId)?.characterId : undefined,
    request: async (method, id, args) => {
      if (!getCharacter(id) || id === ASSISTANT_CHARACTER_ID) throw new Error('此联系人不支持持续工作。')
      await ensure(); await rpc('sync', '', [identities()]); return rpc(method, id, args)
    }
  })) if (!getRegisteredTool(tool.name)) registerTool(tool)
  for (const method of ['get', 'save', 'savePreferences', 'run', 'pause', 'detail', 'answer', 'remember', 'forget', 'createTopic', 'editTopic', 'topicStatus', 'focusTopic', 'topicDetail']) {
    ipcMain.handle(`agents:${method}`, async (_event, id: string, ...args: unknown[]) => {
      if (typeof id !== 'string' || !getCharacter(id) || id === ASSISTANT_CHARACTER_ID) throw new Error('此联系人不支持持续工作。')
      await ensure(); await rpc('sync', '', [identities()]); return rpc(method, id, args)
    })
  }
  void ensure().catch(() => {})
  syncTimer = setInterval(() => { if (child && !starting && !closing) void rpc('sync', '', [identities()]).then(() => { for (const identity of identities()) void deliver(identity.id) }).catch(() => {}) }, 30000)
}
export async function closeAgents() {
  closing = true; clearInterval(syncTimer)
  try { await starting; if (child) await rpc('close') } catch { /* killed processes recover from their checkpoints */ }
  child?.kill(); child = undefined
}
