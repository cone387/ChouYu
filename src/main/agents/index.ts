import { AgentWorkerRPC } from './worker-rpc'
import { appendFileSync, existsSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { registerPresentationProtocol } from './presentation-protocol'
import { deliveryHtmlExport } from '../../shared/delivery-presentation'
import { notifyReminderChanges } from '../reminder-events'
import { app, BrowserWindow, dialog, ipcMain, utilityProcess, type UtilityProcess } from 'electron'
import { writeFile } from 'node:fs/promises'
import { deliveryMarkdown, type AgentDelivery } from '../../shared/agent-delivery'
import { join } from 'node:path'
import { appendAgentNotice, getCharacter, getConfig, getSession, getSessions, listCharacters, getState, setState } from '../database'
import type { AgentNotice } from '../../shared/agents'
import { createContactTools } from './tools'
import { contactConversation } from './conversation'
import { getRegisteredTool, registerTool } from '../tools/registry'
import { ASSISTANT_CHARACTER_ID, DEFAULT_CHARACTER_ID, resolveCharacterConfig, resolveCharacterSoul } from '../../shared/characters'
import type { AgentIdentity } from './service'
import { setupIdeaLab } from './idea-lab'

let child: UtilityProcess | undefined
let starting: Promise<void> | undefined
let closing = false
let failures = 0
let syncTimer: ReturnType<typeof setInterval> | undefined
const requests = new AgentWorkerRPC(event => {
  // Only protocol metadata; never persist credentials, prompts or provider responses.
  try {
    const path = join(app.getPath('userData'), 'contact-worker-diagnostics.log')
    if (existsSync(path) && statSync(path).size > 65536) writeFileSync(path, '')
    appendFileSync(path, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n')
  } catch { /* Diagnostic storage must not block recovery. */ }
})
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
          notifyReminderChanges()
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
  if (!child) return Promise.reject(new Error('Agent 执行进程不可用，请稍后重试。'))
  return requests.request(child, method, id, args)
}
function identities(): AgentIdentity[] {
  const config = getConfig(), sessions = getSessions()
  return listCharacters().filter(c => c.id !== ASSISTANT_CHARACTER_ID).map(character => {
    const resolved = resolveCharacterConfig(character, config)
    const conversation = contactConversation(sessions.filter(s => s.characterId === character.id).slice(0, 2).flatMap(s => getSession(s.id)?.messages ?? []))
    return { visibleNoticeIds: sessions.filter(s => s.characterId === character.id).flatMap(s => (getSession(s.id)?.messages ?? []).filter(m => m.agentNotice && m.id.startsWith('agent:')).map(m => m.id.slice(6))), id: character.id, name: character.name, soul: resolveCharacterSoul(character, config), conversation, searchKey: getState(`agent-search:${character.id}:api_key`) || '', config: resolved.ok ? { provider: resolved.config.provider, baseUrl: resolved.config.baseUrl, apiKey: resolved.config.apiKey, model: resolved.config.model, thinkingDisabledModels: config.thinkingDisabledModels } : null }
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
      if (child !== process) return
      if (message.changed) { broadcastChanged(message.changed); return }
      requests.receive(process, message)
    })
    process.on('exit', () => {
      requests.exited(process)
      if (child !== process) return
      child = undefined
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
/** Read-only access for ChouYu's assistant; no contact mutations are exposed. */
export async function inspectContactWork(characterId: string) {
  if (!getCharacter(characterId) || characterId === ASSISTANT_CHARACTER_ID) throw new Error('联系人不存在。')
  await ensure()
  await rpc('sync', '', [identities()])
  const overview = await rpc('get', characterId) as import('../../shared/agents').AgentOverview
  return { ...overview, pendingInteractions: await rpc('pendingInteractions', characterId) as import('../../shared/contact-interactions').ContactInteraction[] }
}
export async function inspectContactDelivery(characterId: string, topicId: string) {
  if (!getCharacter(characterId) || characterId === ASSISTANT_CHARACTER_ID) throw new Error('联系人不存在。')
  await ensure()
  return rpc('inspectDelivery', characterId, [topicId])
}
/** Main-process entry for the contact-task gateway; mirrors the agents:* IPC guards. */
export async function contactAgentsCall<T = unknown>(id: string, method: string, args: unknown[] = []): Promise<T> {
  if (typeof id !== 'string' || !getCharacter(id) || id === ASSISTANT_CHARACTER_ID) throw new Error('此联系人不支持持续工作。')
  await ensure(); await rpc('sync', '', [identities()]); return rpc(method, id, args) as Promise<T>
}
export async function startIdeaLab() {
  await ensure()
  return setupIdeaLab((method, id, args) => rpc(method, id, args), async () => { await rpc('sync', '', [identities()]) })
}
export async function removeContactAgent(characterId: string) { setState(`agent-search:${characterId}:api_key`, ''); await ensure(); await rpc('remove', characterId) }
export async function restartAgentsForSmoke() {
  if (process.env.CHOUYU_SMOKE_TEST !== '1') throw new Error('Smoke only')
  const previous = child
  if (previous) await new Promise<void>(resolve => { previous.once('exit', () => resolve()); previous.kill() })
  await ensure()
}
export function initializeAgents() {
  registerPresentationProtocol(async (id, topicId, version) => {
    if (!getCharacter(id) || id === ASSISTANT_CHARACTER_ID) throw new Error('联系人不存在。')
    await ensure()
    const artifact = await rpc('delivery', id, [topicId, version]) as AgentDelivery | null
    const detail = await rpc('topicDetail', id, [topicId])
    return { title: detail.topic.title, artifact }
  })
  ipcMain.handle('agents:pendingInteractions', async (_event, owner: string) => {
    if (!getCharacter(owner)) throw new Error('联系人不存在。')
    await ensure()
    const contacts = listCharacters().filter(c => c.id !== ASSISTANT_CHARACTER_ID && c.id !== DEFAULT_CHARACTER_ID && (owner === DEFAULT_CHARACTER_ID || c.id === owner))
    const result = []
    for (const contact of contacts) {
      const items = await rpc('pendingInteractions', contact.id) as import('../../shared/contact-interactions').ContactInteraction[]
      for (const item of items) result.push({ ...item, characterName: contact.name })
    }
    return result
  })
  ipcMain.handle('agents:dashboard', async () => {
    await ensure()
    return rpc('dashboard', '', [listCharacters().filter(c => c.id !== ASSISTANT_CHARACTER_ID).map(c => c.id)])
  })
  ipcMain.handle('agents:exportDelivery', async (event, id: string, topicId: string, version: number, format: 'markdown' | 'html' = 'markdown') => {
    if (typeof id !== 'string' || !getCharacter(id) || id === ASSISTANT_CHARACTER_ID) throw new Error('联系人不存在。')
    await ensure()
    const artifact = await rpc('delivery', id, [topicId, version]) as AgentDelivery | null
    const detail = await rpc('topicDetail', id, [topicId])
    if (!artifact) throw new Error('尚无可导出的成果。')
    if (!['markdown', 'html'].includes(format)) throw new Error('导出格式无效。')
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options = { title: '导出此版本成果', defaultPath: `${detail.topic.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80)}-v${artifact.version}.${format === 'html' ? 'html' : 'md'}`, filters: [{ name: format === 'html' ? 'HTML 阅读页面' : 'Markdown', extensions: [format === 'html' ? 'html' : 'md'] }] }
    const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return false
    await writeFile(result.filePath, format === 'html' ? deliveryHtmlExport(detail.topic.title, artifact, randomUUID()) : deliveryMarkdown(detail.topic.title, artifact), 'utf8')
    return true
  })
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
  for (const method of ['getInteraction', 'submitInteraction', 'get', 'save', 'savePreferences', 'run', 'pause', 'detail', 'answer', 'remember', 'forget', 'createTopic', 'assignTopic', 'deleteTopic', 'editTopic', 'topicStatus', 'focusTopic', 'topicDetail', 'interactions', 'delivery', 'reviseTopic', 'continueTopic', 'setTaskBudget', 'analytics', 'summary']) {
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
