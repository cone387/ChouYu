import { validateContactActionRequest } from '../../shared/contact-actions'
import { chatHarness, harnessRegistry } from '../harness/service'
import type { HarnessInput, HarnessConfirmation } from '../harness/contracts'
import { prepareHarnessInput, harnessConfigVersion } from '../harness/prepare'
import { createChatTools, type ChatRequestState } from '../harness/tools'
import { contactCommunicationInstructions } from '../../shared/contact-communication'
import { contactSkillRunner, getContactSkills } from '../skills'
import { SKILL_TOOLS, skillToolRuntime } from '../skills/tools'
import { assistantWorkInstructions } from '../../shared/assistant-work-instructions'
import { contactWorkInstructions } from '../../shared/contact-work-instructions'
import { BrowserWindow } from 'electron'
import type { AIStreamEvent, AIStreamResult } from '../../shared/ai'
import { ASSISTANT_CHARACTER_ID, DEFAULT_CHARACTER_ID, resolveCharacterConfig } from '../../shared/characters'
import { dispatchContactCall, agentContext, contactAgentsCall, onContactContextChanged, runContactChat } from '../agents'
import { routeContactChange } from '../agents/chat-changes'
import { readContactConfiguration, submitContactInteraction, pendingContactInteractions } from '../agents'
import { type ContactActionInteraction } from '../../shared/contact-actions'
import { streamSystemModel as streamNativeChat } from '../harness/model-service'
import { prepareRegisteredToolAsync, getRegisteredTool, getToolDefinitions } from '../tools/registry'
import { type ToolExecutionEvent } from '../../shared/tools'
import { getConfig, getCharacter, getSession, setState } from '../database'
import type { ChatExecution } from './service'
import type { ChatToolApprovals } from './tool-approvals'
import { isToolEnabled } from './tool-policy'

function getErrorMessage(error: unknown): string { return error instanceof Error && error.message ? error.message : 'AI 请求失败，请检查 Provider 配置和网络后重试。' }
function sendToolEvent(sender: ChatExecution['sender'], event: ToolExecutionEvent) { if (!sender.isDestroyed()) sender.send('ai:tool-event', event) }

export async function executeChat({ sender, request, requestKey, controller }: ChatExecution, mainWindow: BrowserWindow, approvals: ChatToolApprovals): Promise<AIStreamResult> {
  const acceptedAt = Date.now()
  const savedUsers = request.sessionId ? getSession(request.sessionId)?.messages.filter(message => message.role === 'user') ?? [] : []
  const userTurns = request.messages.filter(message => message.role === 'user').map(message => ({ text: message.content,
    at: savedUsers.findLast(saved => saved.content === message.content)?.timestamp ?? acceptedAt }))
  const taskSource = { text: userTurns.map(turn => turn.text).join('\n').slice(-16000), turns: userTurns, acceptedAt: userTurns.at(-1)?.at ?? acceptedAt }
  const owner = request.sessionId ? getSession(request.sessionId)?.characterId : request.characterId || DEFAULT_CHARACTER_ID

  if (request.sessionId && !owner) return { ok: false, error: '会话已不存在，请重新打开对话。' }

  if (request.characterId && !getCharacter(request.characterId)) return { ok: false, error: '联系人已不存在。' }

  if (owner && request.characterId && owner !== request.characterId) return { ok: false, error: '会话与联系人不匹配。' }

  if (owner) request.characterId = owner

  // Freeze the choice before context preparation or intent routing can yield.
  const selectedEngine = chatHarness.engineFor(owner)

  const selectedModule = harnessRegistry.get(selectedEngine)

  const config = getConfig()

  let effectiveConfig = config

  if (request.characterId) {
    const resolution = resolveCharacterConfig(getCharacter(request.characterId), config)
    if (!resolution.ok) return { ok: false, error: resolution.error }
    effectiveConfig = { ...config, ...resolution.config }
  }

  const chatState: ChatRequestState = { ownMemoryMutation: false, memoryMutationReceipt: '' }

  let contextSent = false

  let harnessInput:HarnessInput|undefined

  const assertContext = async () => {
    controller.signal.throwIfAborted()
    if(harnessInput){
      const base=getConfig(),current=resolveCharacterConfig(request.characterId?getCharacter(request.characterId):undefined,base)
      if(!current.ok||harnessConfigVersion({...base,...current.config})!==harnessInput.configVersion)throw new Error('模型或工具配置已变化，请重新发送消息。')
    }
    if (owner && chatState.contactContext) await contactAgentsCall(owner, 'assertContextCurrent', [chatState.contactContext])
    controller.signal.throwIfAborted()
  }

  const releaseContext = onContactContextChanged(id => {
    if (id === owner && chatState.contactContext && !chatState.ownMemoryMutation) void assertContext().catch(() => { if (!chatState.ownMemoryMutation) controller.abort() })
  })

  try {
    const skillSnapshot = request.characterId ? getContactSkills(request.characterId) : { entries: [], instruction: '' }
    if (skillSnapshot.error) throw new Error(skillSnapshot.error)
    const skillContext = skillSnapshot.instruction
    const buildSkillTools = (signal: AbortSignal) => skillToolRuntime(request.characterId || '', skillSnapshot, contactSkillRunner(), signal, async (skillId, files) => {
      signal.throwIfAborted()
      if (!owner || !request.sessionId || getSession(request.sessionId)?.characterId !== owner) throw new Error('文件缺少可验证的会话来源。')
      return contactAgentsCall(owner, 'archiveFiles', [{ characterId: owner, skillId, sessionId: request.sessionId, requestId: request.requestId }, files])
    })
    let privateContext = ''
    if (owner) {
      try {
        const latest = request.messages.filter(m => m.role === 'user').at(-1)
        const refs = latest?.contactCitations
        const topicId = refs?.length && refs.every(ref => ref.ref.topicId === refs[0].ref.topicId) ? refs[0].ref.topicId : undefined
        const selected = await agentContext(owner, { characterId: owner, sessionId: request.sessionId, topicId, query: latest?.content || '' })
        privateContext = selected.text
        chatState.contactContext = { characterId: owner, requestId: request.requestId, memories: selected.memories, truncated: selected.truncated, status: 'completed' }
      } catch { privateContext = '\n独立工作记录暂时无法读取，请勿声称知道未提供的工作经历。' }
    }
    const buildChatTools = (confirmation: HarnessConfirmation, signal = controller.signal) => {
      const skillTools = buildSkillTools(signal)
      return config.aiToolsEnabled ? createChatTools({
        request, owner, signal, cancel: () => controller.abort(), state: chatState,
        confirmation,
        definitions: getToolDefinitions().filter((tool) => isToolEnabled(tool.name)
          && (!SKILL_TOOLS.some(skill => skill.name === tool.name) || skillTools.definitions.some(skill => skill.name === tool.name))
          && (owner === DEFAULT_CHARACTER_ID || !['inspect_contacts', 'list_assistant_routines', 'save_assistant_routine'].includes(tool.name))),
        getDefinition: getRegisteredTool, getConfig, isToolEnabled, assertContext,
        prepare: async (call, args) => SKILL_TOOLS.some(tool => tool.name === call.name) ? { execute: () => skillTools.executeResult(call) } : prepareRegisteredToolAsync(call.name, args, mainWindow, request.sessionId, undefined, `chat:${request.requestId}:${call.id}`, taskSource),
        contactPolicy: async () => owner ? (await contactAgentsCall(owner, 'get') as import('../../shared/agents').AgentOverview).settings.toolPermissionMode : undefined,
        offerAction: (key, action) => contactAgentsCall(owner!, 'offerAction', [key, validateContactActionRequest(action)]),
        approve: (call, preview) => approvals.request(sender, request.requestId, call, signal, preview),
        emit: toolEvent => sendToolEvent(sender, toolEvent)
      }) : undefined
    }
    const chatTools = buildChatTools({ mode: 'return-card' })
    const currentCitations = [...request.messages].reverse().find(m => m.role === 'user')?.contactCitations
    if (owner && owner !== ASSISTANT_CHARACTER_ID && chatTools && !currentCitations?.length) {
      const routed = await routeContactChange(request.messages, {
        configuration: async () => readContactConfiguration(owner),
        outputPreferences: async () => contactAgentsCall(owner, 'outputPreferenceCatalogue'),
        interactions: () => pendingContactInteractions(owner),
        submitInteraction: async (id, submission) => {
          const card = (await pendingContactInteractions(owner)).find(card => card.id === id)
          if (!card) throw new Error('该事项已处理或不属于可处理的联系人，请重新读取。')
          return submitContactInteraction(card.characterId, id, submission, mainWindow)
        },
        assistant: owner === DEFAULT_CHARACTER_ID,
        read: (method, args) => dispatchContactCall(owner, method, args),
        model: async (prompt, content) => {
          let output = ''
          await streamNativeChat([{ role: 'user', content }], prompt, effectiveConfig, chunk => {
            output += chunk
            if (output.length > 16000) throw new Error('任务修改解析结果过长，本次未修改。')
          }, controller.signal, undefined, { timeoutMs: 60000, maxOutputTokens: 3000 })
          if (process.env.CHOUYU_SMOKE_TEST === '1' && process.env.CHOUYU_SMOKE_CONTACT_LIVE === '1') console.log('CONTACT_LIVE_ROUTE', JSON.stringify({ requestId: request.requestId, output }))
          return output
        },
        execute: chatTools.execute,
        executeConfigurationStep: (call, step) => chatTools.execute(call, step)
      })
      if (routed !== undefined) {
        return { ok: true, reply: routed }
      }
    }
    harnessInput = await prepareHarnessInput(request, {
      config: effectiveConfig, signal: controller.signal, assertContext,
      citationContext: citations => contactAgentsCall(owner!, 'citationContext', [citations]),
      privateContext, skillContext,
      communication: owner === DEFAULT_CHARACTER_ID ? contactWorkInstructions + assistantWorkInstructions : owner && owner !== ASSISTANT_CHARACTER_ID ? contactWorkInstructions : contactCommunicationInstructions('conversation'),
      onMetadata: () => { contextSent = true }
    })
    // Main-process identity scopes equal renderer request ids to their owning sender.
    harnessInput.requestId = requestKey
    harnessInput.bindTools = run => buildChatTools(selectedModule.confirmation(run), run.signal)
    const result = await runContactChat(harnessInput, update => {
      if (sender.isDestroyed()) return
      if (update.type === 'text') {
        const streamEvent: AIStreamEvent = { requestId: request.requestId, chunk: update.text, done: false, operation:update.operation,attemptId:update.attemptId,sequence:update.seq }
        sender.send('ai:stream-event', streamEvent)
      }
    }, selectedEngine)
    if (result.state !== 'completed') throw new Error(result.error)

    await assertContext()
    if (contextSent && chatState.contactContext) setState(`contact-context:${request.requestId}`, JSON.stringify(chatState.contactContext))
    return { ok: true, contactContext: contextSent ? chatState.contactContext : undefined, ...(result.source?{reply:result.text,operation:'replace' as const,harnessSource:result.source}:{}) }
  } catch (error) {
    if (harnessInput) {
      try { await selectedModule.adapter.invalidate?.(harnessInput) }
      catch (cleanupError) { error = new Error(`${getErrorMessage(error)} 清理未完成：${getErrorMessage(cleanupError)}`) }
    }
    if (contextSent && chatState.contactContext) { chatState.contactContext.status = 'failed'; setState(`contact-context:${request.requestId}`, JSON.stringify(chatState.contactContext)) }
    if (chatState.memoryMutationReceipt) return { ok: true, reply: chatState.memoryMutationReceipt }
    if (controller.signal.aborted) return { ok: false, error: 'AI 请求已取消。' }
    return { ok: false, error: getErrorMessage(error), contactContext: contextSent && chatState.contactContext ? { ...chatState.contactContext, status: 'failed' } : undefined }
  } finally {
    releaseContext()
  }
}
