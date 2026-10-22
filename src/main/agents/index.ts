import { validateContactCommand, type ContactCommandName, type ContactArgs, type ContactResult, type EmptyContactCommand } from '../../shared/contact-commands'
import type { WorkerCommandName, WorkerArgs, WorkerResult } from '../agent-space/worker-rpc'
import { contactHandle } from './query-metrics'
import { AgentSpace } from '../agent-space/service'
import { taskCenter } from '../task-center/service'
import { createContactDomain, isContactTaskMethod } from '../task-center/contact-domain'
import { chatHarness } from '../harness/service'
import { resolveDshRuntimePaths } from '../harness/dsh/runtime'
import type { HarnessInput, HarnessEvent } from '../harness/contracts'
import type { HarnessEngine } from '../../shared/harness'
import { AgentWorkerRPC } from '../agent-space/worker-rpc'
import { configureContactSkill, contactSkillLibrary, getContactSkills, findContactSkills, installContactSkill, contactSkillRunner } from '../skills'
import { SKILL_TOOLS } from '../skills/tools'
import { appendFileSync, existsSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { registerPresentationProtocol } from './presentation-protocol'
import { deliveryHtmlExport } from '../../shared/delivery-presentation'
import { deliverMessage } from '../messaging'
import { app, BrowserWindow, dialog, utilityProcess, type UtilityProcess } from 'electron'
import { writeFile } from 'node:fs/promises'
import { deliveryMarkdown, type AgentDelivery } from '../../shared/agent-delivery'
import { join } from 'node:path'
import { getCharacter, getConfig, getSession, getSessions, listCharacters, getState, setState, getContactProfile, updateContactProfile, contactSearchCredential, saveContactSearchCredential } from '../database'
import type { AgentNotice } from '../../shared/agents'
import { createContactTools } from './tools'
import { createContactProfileTools } from './profile-tools'
import { createOutputTools } from './output-tools'
import { createDeliveryFeedbackTools } from './delivery-feedback'
import { notifyJournalConfig } from '../journal'
import { createMemoryTools } from './memory-tools'
import { createMaterialTools, MATERIAL_TOOL_NAMES } from './material-tools'
import { loadMaterialImport } from './material-import'
import { readSource } from './sources'
import { readFile, stat } from 'node:fs/promises'
import { contactConversation } from './conversation'
import { getRegisteredTool, registerTool, prepareRegisteredToolAsync } from '../tools/registry'
import { executeContactAction } from './action-executor'
import { createInteractionTools } from './interaction-tools'
import { createContactSupportTools } from './support-tools'
import { ASSISTANT_CHARACTER_ID, DEFAULT_CHARACTER_ID, resolveCharacterConfig, resolveCharacterSoul } from '../../shared/characters'
import type { ContactIdentity } from '../agent-space/workloop-host'
import { setupIdeaLab } from './idea-lab'
import { validateMemoryInput } from '../../shared/contact-memories'

let child: UtilityProcess | undefined
let starting: Promise<void> | undefined
let closing = false
let failures = 0
let syncTimer: ReturnType<typeof setInterval> | undefined
const requests = new AgentWorkerRPC(event => {
  if (process.env.CHOUYU_SMOKE_TEST === '1') console.error('CHOUYU_AGENT_RPC', JSON.stringify(event))
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
          deliverMessage({ kind: 'agent', notice })
          await rpc('ackNotice', characterId, [notice.id])
        }
        const cards = await rpc('actionNotices', characterId) as import('../../shared/contact-actions').ContactActionInteraction[]
        for (const card of cards) {
          deliverMessage({ kind: 'interaction', card })
          await rpc('ackActionNotice', characterId, [card.id])
        }
      } catch { /* Durable outbox is retried by the sync timer after storage/process recovery. */ }
    }
  } finally { delivering = false }
}
const contextListeners = new Set<(owner: string) => void>()
export function onContactContextChanged(listener: (owner: string) => void) { contextListeners.add(listener); return () => { contextListeners.delete(listener) } }
function broadcastChanged(characterId: string) {
  for (const listener of contextListeners) listener(characterId)
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('agents:changed', characterId)
  void deliver(characterId)
}
function workerRpc<M extends WorkerCommandName>(method: M, id = '', args: WorkerArgs<M> = [] as WorkerArgs<M>): Promise<WorkerResult<M>> {
  if (!child) return Promise.reject(new Error('Agent 执行进程不可用，请稍后重试。'))
  return requests.request(child, method, id, args)
}
const contactSpace = new AgentSpace({ harness: chatHarness, readIdentity: id => identities(id)[0], work: {
  request: workerRpc,
  detach: async id => { await starting; if (child) await workerRpc('detachModule', id, ['workloop']) },
  remove: async id => { await workerRpc('remove', id) }
} })
const contactTasks = taskCenter.register(createContactDomain(contactSpace))
function rpc<M extends WorkerCommandName>(method: M, id = '', args: WorkerArgs<M> = [] as WorkerArgs<M>): Promise<WorkerResult<M>> {
  return dispatchAgentCommand(method, id, args) as Promise<WorkerResult<M>>
}
async function dispatchAgentCommand(method: unknown, owner: unknown, values: unknown = []): Promise<unknown> {
  if (typeof method !== 'string' || typeof owner !== 'string' || !Array.isArray(values)) throw new Error('联系人操作参数无效。')
  const id = owner, args = values
  if (!['init', 'sync', 'syncContact', 'close'].includes(method)) validateContactCommand(method, id, args)
  if (!id || ['syncContact', 'detachModule', 'remove'].includes(method)) {
    if (!child) throw new Error('Agent 执行进程不可用，请稍后重试。')
    return requests.dispatchUnknown(child, method, id, args)
  }
  if (isContactTaskMethod(method)) return Promise.resolve(taskCenter.dispatchUnknown({ domain: 'contact', owner: id }, method, args))
  return contactSpace.dispatchUnknown(method, id, args)
}
export function runContactChat(input: HarnessInput, output: (event: HarnessEvent) => void, engine?: HarnessEngine) {
  return contactSpace.runChat(input, output, engine)
}
export function cancelContactChat(requestId: string) { return contactSpace.cancelChat(requestId) }
export function closeContactSpace() { return contactSpace.close() }
function identities(onlyId?: string): ContactIdentity[] {
  const config = getConfig(), sessions = getSessions()
  return listCharacters().filter(c => c.id !== ASSISTANT_CHARACTER_ID && (!onlyId || c.id === onlyId)).map(character => {
    const resolved = resolveCharacterConfig(character, config)
    let skillsRevision: number | undefined
    try { skillsRevision = contactSkillLibrary().list(character.id).revision } catch { /* The skill snapshot carries its own error; keep unrelated contacts readable. */ }
    const conversation = contactConversation(sessions.filter(s => s.characterId === character.id).slice(0, 2).flatMap(s => getSession(s.id)?.messages ?? []))
    return { backgroundHarnessEngine: character.backgroundHarnessEngine ?? 'native', configurationVersions: { profile: getContactProfile(character.id).revision, skills: skillsRevision, credential: contactSearchCredential(character.id).revision }, sessionIds: sessions.filter(s => s.characterId === character.id).map(s => s.id), skillToolsEnabled: config.aiToolsEnabled, disabledSkillTools: [...SKILL_TOOLS.map(tool => tool.name), ...MATERIAL_TOOL_NAMES].filter(name => getState(`tool:${name}:enabled`) === 'false'), skills: getContactSkills(character.id), visibleNoticeIds: sessions.filter(s => s.characterId === character.id).flatMap(s => (getSession(s.id)?.messages ?? []).filter(m => m.agentNotice && m.id.startsWith('agent:')).map(m => m.id.slice(6))), id: character.id, name: character.name, soul: resolveCharacterSoul(character, config), conversation, searchKey: getState(`agent-search:${character.id}:api_key`) || '', config: resolved.ok ? { provider: resolved.config.provider, baseUrl: resolved.config.baseUrl, apiKey: resolved.config.apiKey, model: resolved.config.model, thinkingDisabledModels: config.thinkingDisabledModels } : null }
  })
}
async function syncContact(id: string) {
  const identity = identities(id)[0]
  if (!identity) throw new Error('联系人不存在。')
  await rpc('syncContact', id, [contactSpace.workerIdentity(identity)])
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
      await rpc('init', '', [join(app.getPath('userData'), 'contact-agents'), {
        ...resolveDshRuntimePaths(app.isPackaged ? globalThis.process.resourcesPath : app.getAppPath(), app.isPackaged),
        home: join(app.getPath('userData'), 'contact-agents', 'harness')
      }])
      const current = identities().map(identity => contactSpace.workerIdentity(identity))
      await rpc('sync', '', [current])
      // In-flight UI reads may have been rejected during the exit. A restored
      // waiting run emits no new graph event, so explicitly invalidate the UI.
      for (const identity of current) broadcastChanged(identity.id)
    }
    catch (error) { process.kill(); throw error }
  })().finally(() => { starting = undefined; for (const id of dirty) void deliver(id) })
  return starting
}
export async function agentContext(characterId: string, context: import('../../shared/contact-content').ContactReadContext) { await ensure(); await syncContact(characterId); return await rpc('contextSnapshot', characterId, [context]) as { text: string; memories: { id: string; revision: number }[]; truncated: boolean } }
/** Read-only access for ChouYu's assistant; no contact mutations are exposed. */
export async function inspectContactWork(characterId: string) {
  if (!getCharacter(characterId) || characterId === ASSISTANT_CHARACTER_ID) throw new Error('联系人不存在。')
  await ensure()
  await syncContact(characterId)
  const overview = await rpc('get', characterId) as import('../../shared/agents').AgentOverview
  return { ...overview, pendingInteractions: await rpc('pendingInteractions', characterId) as import('../../shared/contact-interactions').ContactInteraction[] }
}
export async function inspectContactDelivery(characterId: string, topicId: string) {
  if (!getCharacter(characterId) || characterId === ASSISTANT_CHARACTER_ID) throw new Error('联系人不存在。')
  await ensure()
  return rpc('inspectDelivery', characterId, [topicId])
}
let purgeHarnessContact:(owner:string)=>Promise<unknown>=async()=>{}
export function setContactHarnessPurge(purge:typeof purgeHarnessContact){purgeHarnessContact=purge}
async function purgeWithdrawnContext(id:string,method:string){if(['withdrawMaterial','purgeMaterial','forgetMemory','updateMemory','deleteTopic'].includes(method))await purgeHarnessContact(id)}
/** Main-process entry for the contact-task gateway; mirrors the agents:* IPC guards. */
export function contactAgentsCall<M extends EmptyContactCommand>(id: string, method: M): Promise<ContactResult<M>>
export function contactAgentsCall<M extends ContactCommandName>(id: string, method: M, args: ContactArgs<M>): Promise<ContactResult<M>>
export async function contactAgentsCall(id: string, method: ContactCommandName, args: unknown[] = []): Promise<unknown> {
  return dispatchContactCall(id, method, args)
}
export async function dispatchContactCall(id: string, method: unknown, args: unknown = []): Promise<unknown> {
  validateContactCommand(method, id, args)
  if (typeof id !== 'string' || !getCharacter(id) || id === ASSISTANT_CHARACTER_ID) throw new Error('此联系人不支持持续工作。')
  validateMemoryBoundary(id, method, args as unknown[])
  await purgeWithdrawnContext(id,method)
  await ensure(); await syncContact(id); return dispatchAgentCommand(method, id, args)
}
export function readContactConfiguration(id: string) {
  if (!getCharacter(id) || id === ASSISTANT_CHARACTER_ID) throw new Error('联系人不存在。')
  return { profile: getContactProfile(id), skills: contactSkillLibrary().list(id), searchCredential: contactSearchCredential(id) }
}
function validateMemoryBoundary(owner: string, method: string, args: unknown[]) {
  if (method !== 'createMemory' && method !== 'updateMemory') return
  const input = validateMemoryInput(args[method === 'createMemory' ? 0 : 2])
  if (input.scope.kind === 'session' && getSession(input.scope.sessionId)?.characterId !== owner) throw new Error('记忆会话不属于此联系人。')
  if (input.source.kind === 'conversation') {
    const source = input.source, session = getSession(source.sessionId)
    if (session?.characterId !== owner || !session.messages.some(message => message.id === source.messageId)) throw new Error('对话来源不存在或不属于此联系人。')
  }
}
export async function submitContactInteraction(id: string, interactionId: string, submission: import('../../shared/contact-interactions').ContactInteractionSubmission, window: BrowserWindow) {
  const card = await contactAgentsCall(id, 'getInteraction', [interactionId])
  if (card.kind !== 'action') return contactAgentsCall(id, 'submitInteraction', [interactionId, submission])
  await executeContactAction({
    read: () => readContactAction(id, interactionId), claim: (version, response) => contactAgentsCall(id, 'claimAction', [interactionId, version, response]),
    start: version => contactAgentsCall(id, 'startActionExecution', [interactionId, version]),
    acknowledge: version => contactAgentsCall(id, 'acknowledgeAction', [interactionId, version]),
    finish: (version, result) => contactAgentsCall(id, 'finishAction', [interactionId, version, result]), fail: (version, message) => contactAgentsCall(id, 'failAction', [interactionId, version, message]), reject: version => contactAgentsCall(id, 'rejectAction', [interactionId, version]),
    prepare: async (option, sessionId, credential) => {
      if (getSession(sessionId)?.characterId !== id) throw new Error('原会话已删除或归属变化，此操作未执行。')
      if (!getConfig().aiToolsEnabled || getState(`tool:${option.tool}:enabled`) === 'false') throw new Error('工具已被用户禁用，此操作未执行。')
      return prepareRegisteredToolAsync(option.tool, option.arguments, window, sessionId, credential, `action:${interactionId}`)
    }
  }, submission)
  return contactAgentsCall(id, 'getInteraction', [interactionId])
}
export async function readContactAction(id: string, interactionId: string) {
  const value = await contactAgentsCall(id, 'getInteraction', [interactionId])
  if (value.kind !== 'action') throw new Error('交互事项类型已变化，请重新读取。')
  return value
}
export async function startIdeaLab() {
  await ensure()
  return setupIdeaLab((method, id, args) => rpc(method, id, args), async () => { await rpc('sync', '', [identities().map(identity => contactSpace.workerIdentity(identity))]) })
}
export async function removeContactAgent(characterId: string) { setState(`agent-search:${characterId}:api_key`, ''); await ensure(); await contactSpace.remove(characterId) }
export async function pendingContactInteractions(owner: string) {
  if (!getCharacter(owner)) throw new Error('联系人不存在。')
  await ensure()
  const contacts = listCharacters().filter(c => c.id !== ASSISTANT_CHARACTER_ID && (owner === DEFAULT_CHARACTER_ID || c.id === owner))
  const result: import('../../shared/contact-interactions').ContactInteraction[] = []
  for (const contact of contacts) {
    const items = await rpc('pendingInteractions', contact.id) as import('../../shared/contact-interactions').ContactInteraction[]
    for (const item of items) result.push({ ...item, characterName: contact.name })
  }
  return result
}
export async function restartAgentsForSmoke() {
  if (process.env.CHOUYU_SMOKE_TEST !== '1') throw new Error('Smoke only')
  const previous = child
  if (previous) await new Promise<void>(resolve => { previous.once('exit', () => resolve()); previous.kill() })
  await ensure()
}
export function initializeAgents() {
  contactHandle('agents:profile', async (_event, id: string) => getContactProfile(id))
  for (const tool of createContactSupportTools({
    owner: sessionId => sessionId ? getSession(sessionId)?.characterId : undefined,
    credential: contactSearchCredential, saveCredential: (owner, secret, revision) => { const result = saveContactSearchCredential(owner, secret, revision); broadcastChanged(owner); return result },
    skills: async owner => contactSkillLibrary().list(owner), catalog: findContactSkills, runtime: id => contactSkillRunner().statusForSkill(id),
    install: installContactSkill, prepareRuntime: () => contactSkillRunner().prepare(AbortSignal.timeout(720000)),
    prepareDependencies: (owner, id) => contactSkillRunner().prepareDependencies(owner, id, AbortSignal.timeout(720000)),
    material: async (owner, name, topicId, context) => {
      if (topicId) await contactAgentsCall(owner, 'topicDetail', [topicId])
      const value = await loadMaterialImport({ name, scope: topicId ? { kind: 'task', topicId } : { kind: 'contact' }, source: { kind: 'file', label: '用户在聊天卡片中选择的文件' } }, {
        chooseFile: async () => {
          const selected = await dialog.showOpenDialog(context.mainWindow, { title: '选择一份文本资料', properties: ['openFile'], filters: [{ name: '文本资料', extensions: ['txt', 'md', 'markdown'] }] })
          if (selected.canceled || !selected.filePaths[0]) return null
          if ((await stat(selected.filePaths[0])).size > 2 * 1024 * 1024) throw new Error('单份资料不得超过 2 MB。')
          return { name: selected.filePaths[0], data: await readFile(selected.filePaths[0]) }
        }, readWeb: async () => { throw new Error('当前卡片只支持用户选择文本文件。') }, allowed: async () => false
      }, AbortSignal.timeout(720000))
      if (!value) return null
      if (getSession(context.sessionId!)?.characterId !== owner) throw new Error('原会话已变化，资料未保存。')
      return contactAgentsCall(owner, 'saveMaterial', [value])
    }
  })) if (!getRegisteredTool(tool.name)) registerTool(tool)
  for (const tool of createInteractionTools({
    owner: sessionId => sessionId ? getSession(sessionId)?.characterId : undefined,
    prepare: (option, context) => {
      if (!getConfig().aiToolsEnabled || getState(`tool:${option.tool}:enabled`) === 'false') throw new Error('此操作工具已被禁用。')
      return prepareRegisteredToolAsync(option.tool, option.arguments, context.mainWindow, context.sessionId, undefined, context.executionId)
    },
    offer: (owner, key, request) => contactAgentsCall(owner, 'offerAction', [key, request])
  })) if (!getRegisteredTool(tool.name)) registerTool(tool)
  contactHandle('agents:submitInteraction', async (event, id: string, interactionId: string, submission: import('../../shared/contact-interactions').ContactInteractionSubmission) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('交互窗口不可用。')
    return submitContactInteraction(id, interactionId, submission, window)
  })
  contactHandle('agents:exportContactFile', async (event, owner: string, id: string) => {
    const result = await contactAgentsCall(owner, 'readContactFile', [id])
    const parent = BrowserWindow.fromWebContents(event.sender), options = { title: '导出归档文件', defaultPath: result.file.name.split('/').at(-1) }
    const selected = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
    if (selected.canceled || !selected.filePath) return false
    // Revalidate ownership and bytes after the native dialog returns.
    const current = await contactAgentsCall(owner, 'readContactFile', [id])
    await writeFile(selected.filePath, current.bytes)
    return true
  })
  const imports = new Map<string, AbortController>()
  contactHandle('agents:cancelMaterialImport', (event, owner: string, requestId: string) => { imports.get(`${event.sender.id}:${owner}:${requestId}`)?.abort() })
  contactHandle('agents:importMaterial', async (event, owner: string, input: import('../../shared/contact-materials').MaterialImport) => {
    if (!getCharacter(owner)) throw new Error('联系人不存在。')
    const key = `${event.sender.id}:${owner}:${input.requestId}`, controller = new AbortController()
    imports.get(key)?.abort(); imports.set(key, controller)
    const destroyed = () => controller.abort(); event.sender.once('destroyed', destroyed)
    try {
      const value = await loadMaterialImport(input, {
        chooseFile: async () => {
          const parent = BrowserWindow.fromWebContents(event.sender), options = { title: '选择一份文本资料', properties: ['openFile' as const], filters: [{ name: '文本资料', extensions: ['txt', 'md', 'markdown'] }] }
          const selected = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
          if (selected.canceled || !selected.filePaths[0]) return null
          if ((await stat(selected.filePaths[0])).size > 2 * 1024 * 1024) throw new Error('单份资料不得超过 2 MB。')
          return { name: selected.filePaths[0], data: await readFile(selected.filePaths[0]) }
        },
        readWeb: async (url, signal) => (await readSource(url, signal)).text,
        allowed: async url => { const overview = await contactAgentsCall(owner, 'get'); return overview.settings.permissionLevel !== 'sources' || overview.settings.sources.includes(url) }
      }, controller.signal)
      controller.signal.throwIfAborted()
      if (!value) return null
      return await contactAgentsCall(owner, 'saveMaterial', [value, input.id, input.expectedVersion])
    } finally { event.sender.removeListener('destroyed', destroyed); if (imports.get(key) === controller) imports.delete(key) }
  })
  for (const tool of createMaterialTools({ owner: sessionId => sessionId ? getSession(sessionId)?.characterId : undefined, dispatchUnknown: (method, owner, args) => dispatchContactCall(owner, method, args) })) if (!getRegisteredTool(tool.name)) registerTool(tool)
  for (const tool of createMemoryTools({ owner: sessionId => sessionId ? getSession(sessionId)?.characterId : undefined, dispatchUnknown: (method, owner, args) => dispatchContactCall(owner, method, args) })) if (!getRegisteredTool(tool.name)) registerTool(tool)
  for (const tool of [...createOutputTools({ owner: sessionId => sessionId ? getSession(sessionId)?.characterId : undefined, dispatchUnknown: (method, owner, args) => dispatchContactCall(owner, method, args) }), ...createDeliveryFeedbackTools({ owner: sessionId => sessionId ? getSession(sessionId)?.characterId : undefined, dispatchUnknown: (method, owner, args) => dispatchContactCall(owner, method, args) })]) if (!getRegisteredTool(tool.name)) registerTool(tool)
  for (const tool of createContactProfileTools({
    owner: sessionId => sessionId ? getSession(sessionId)?.characterId : undefined,
    profile: async id => readContactConfiguration(id).profile,
    skills: async id => readContactConfiguration(id).skills,
    configure: async (id, skillId, action, revision) => configureContactSkill(id, skillId, action, revision),
    update: async (id, patch, revision, reason) => {
      const result = updateContactProfile(id, patch, revision, reason)
      for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) {
        window.webContents.send('characters:changed')
        if (result.builtIn) window.webContents.send('config:changed', getConfig())
      }
      if (result.builtIn) notifyJournalConfig(getConfig())
      return result
    }
  })) if (!getRegisteredTool(tool.name)) registerTool(tool)
  registerPresentationProtocol(async (id, topicId, version) => {
    if (!getCharacter(id) || id === ASSISTANT_CHARACTER_ID) throw new Error('联系人不存在。')
    await ensure()
    const artifact = await rpc('delivery', id, [topicId, version]) as AgentDelivery | null
    const detail = await rpc('topicDetail', id, [topicId])
    return { title: detail.topic.title, artifact }
  })
  contactHandle('agents:pendingInteractions', async (_event, owner: string) => pendingContactInteractions(owner))
  contactHandle('agents:dashboard', async () => {
    await ensure()
    return rpc('dashboard', '', [listCharacters().filter(c => c.id !== ASSISTANT_CHARACTER_ID).map(c => c.id)])
  })
  contactHandle('agents:exportDelivery', async (event, id: string, topicId: string, version: number, format: 'markdown' | 'html' = 'markdown') => {
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
  contactHandle('agents:searchCredential', async (_event, id: string, key?: string, revision?: number) => {
    if (typeof id !== 'string' || !getCharacter(id) || id === ASSISTANT_CHARACTER_ID) throw new Error('联系人不存在。')
    if (key !== undefined) {
      if (typeof key !== 'string' || key.length > 8192 || /[\r\n]/.test(key)) throw new Error('搜索密钥无效。')
      if (!Number.isSafeInteger(revision)) throw new Error('请先读取搜索密钥配置，再保存。')
      saveContactSearchCredential(id, key.trim(), revision!)
      await ensure(); await syncContact(id); broadcastChanged(id)
    }
    return contactSearchCredential(id)
  })
  for (const tool of createContactTools({
    owner: sessionId => sessionId ? getSession(sessionId)?.characterId : undefined,
    dispatchUnknown: async (method, id, args) => {
      if (!getCharacter(id) || id === ASSISTANT_CHARACTER_ID) throw new Error('此联系人不支持持续工作。')
      await ensure(); await syncContact(id); return dispatchAgentCommand(method, id, args)
    }
  })) if (!getRegisteredTool(tool.name)) registerTool(tool)
  for (const method of ['getInteraction', 'outputPreferences', 'setOutputPreference', 'get', 'save', 'savePreferences', 'run', 'pause', 'detail', 'answer', 'remember', 'forget', 'commitHandoff', 'handoffs', 'handoffState', 'returnReview', 'fileList', 'readContactFile', 'contactHome', 'materialList', 'saveMaterial', 'readMaterial', 'materialHistory', 'withdrawMaterial', 'materialInventory', 'purgeMaterial', 'memoryList', 'createMemory', 'updateMemory', 'memoryHistory', 'forgetMemory', 'createTopic', 'assignTopic', 'deleteTopic', 'editTopic', 'topicStatus', 'focusTopic', 'topicDetail', 'interactions', 'delivery', 'deliveryFeedback', 'deliveryFeedbackList', 'portfolio', 'validateCitation', 'reviseCitation', 'setDeliveryFavorite', 'saveDeliveryReading', 'deliveryReading', 'reviseTopic', 'continueTopic', 'setTaskBudget', 'analytics', 'summary']) {
    contactHandle(`agents:${method}`, async (_event, id: string, ...args: unknown[]) => {
      if (typeof id !== 'string' || !getCharacter(id) || id === ASSISTANT_CHARACTER_ID) throw new Error('此联系人不支持持续工作。')
      validateMemoryBoundary(id, method, args)
  await purgeWithdrawnContext(id,method)
      await ensure(); await syncContact(id); return dispatchAgentCommand(method, id, args)
    })
  }
  void ensure().catch(() => {})
  syncTimer = setInterval(() => { if (child && !starting && !closing) void rpc('sync', '', [identities().map(identity => contactSpace.workerIdentity(identity))]).then(() => { for (const identity of identities()) void deliver(identity.id) }).catch(() => {}) }, 30000)
}
export async function closeAgents() {
  closing = true; clearInterval(syncTimer)
  try { await starting; await contactSpace.close(); if (child) await rpc('close') } catch { /* killed processes recover from their checkpoints */ }
  child?.kill(); child = undefined
  contactTasks.dispose()
}
