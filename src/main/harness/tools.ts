import type { AIStreamRequest } from '../../shared/ai'
import type { AppConfig } from '../../shared/config'
import type { ContactContextRecord } from '../../shared/contact-content'
import { CONTACT_ACTION_TOOLS, type ContactActionTool, type ContactActionInteraction } from '../../shared/contact-actions'
import { parseToolArguments, shouldConfirmTool, type AIToolCall, type AIToolDefinition, type ToolExecutionEvent, type ContactToolPermissionMode } from '../../shared/tools'
import { toolApprovalFailure, type ToolApprovalOutcome } from '../tool-approval'
import type { PreparedTool } from '../tools/registry'

export interface ChatRequestState { contactContext?: ContactContextRecord; ownMemoryMutation: boolean; memoryMutationReceipt: string }
export interface ChatToolContext {
  confirmationMode?: 'legacy-return-card' | 'await-receipt'
  beforePersistentOffer?(call:AIToolCall):Promise<void>
  waitForActionReceipt?(call:AIToolCall,card:ContactActionInteraction):Promise<string>
  request: AIStreamRequest
  owner?: string
  signal: AbortSignal
  cancel(): void
  state: ChatRequestState
  definitions: AIToolDefinition[]
  getDefinition(name: string): AIToolDefinition | null | undefined
  getConfig(): AppConfig
  isToolEnabled(name: string): boolean
  assertContext(): Promise<void>
  prepare(call: AIToolCall, args: Record<string, unknown>): Promise<PreparedTool>
  contactPolicy(): Promise<ContactToolPermissionMode | undefined>
  /** The original interaction service validates this persisted action payload. */
  offerAction(key: string, request: unknown): Promise<ContactActionInteraction>
  approve(call: AIToolCall, preview?: string): Promise<ToolApprovalOutcome>
  emit(event: ToolExecutionEvent): void
}

export function createChatTools(context: ChatToolContext) {
  const { request, owner } = context
  let taskMutationRequested = false
  const configurationStepTools = new Set<string>()
  return {
    definitions: context.definitions,
    execute: async (call: AIToolCall, configurationStep?: { index: number; total: number }) => {
      const definition = context.getDefinition(call.name)
      if (!definition) return `工具不存在：${call.name}`
      if (!context.getConfig().aiToolsEnabled || !context.isToolEnabled(call.name)) return `工具已被用户禁用：${call.name}`
      const arguments_ = parseToolArguments(call.arguments)
      try {
        await context.assertContext()
        const taskMutation = CONTACT_ACTION_TOOLS.includes(call.name as ContactActionTool) || ['request_contact_action', 'edit_contact_profile', 'configure_contact_skill', 'edit_contact_task', 'edit_contact_work_settings', 'set_contact_schedule', 'create_task', 'update_task', 'complete_task', 'update_contact_topic', 'answer_contact_question', 'assign_contact_task', 'revise_contact_presentation', 'save_assistant_routine'].includes(call.name)
        if (configurationStep && (!['edit_contact_profile', 'edit_contact_work_settings', 'configure_contact_skill', 'set_contact_search_credential', 'set_contact_output_preference'].includes(call.name) || configurationStepTools.has(call.name) || configurationStepTools.size >= 5 || call.name === 'set_contact_output_preference' && arguments_.scope !== 'contact')) throw new Error('组合设置步骤不在当前联系人允许范围内。')
        if (taskMutation && taskMutationRequested && !configurationStep) throw new Error('每次对话请求只能确认一个任务操作，不支持批量处理。请等待用户下一条明确指令。')
        const prepared: PreparedTool = await context.prepare(call, arguments_)
        if (context.signal.aborted) throw new Error('AI 请求已取消。')
        if (!context.getConfig().aiToolsEnabled || !context.isToolEnabled(call.name)) throw new Error('工具已被用户禁用。')
        if (prepared.noOpResult) {
          const result = prepared.noOpResult
          context.emit({
            requestId: request.requestId, callId: call.id, name: definition.name,
            displayName: definition.displayName, risk: definition.risk,
            status: 'completed', summary: result.summary.slice(0, 500)
          })
          return result.content.slice(0, 50_000)
        }
        if (taskMutation) taskMutationRequested = true
        if (configurationStep) configurationStepTools.add(call.name)
        const contactPolicy = await context.contactPolicy()
        if (context.signal.aborted) throw new Error('AI 请求已取消。')
        const needsApproval = Boolean(configurationStep) || prepared.confirmationRequired === true || shouldConfirmTool(definition, context.getConfig().toolPermissionMode, contactPolicy)
        context.emit({
          requestId: request.requestId,
          callId: call.id,
          name: definition.name,
          displayName: definition.displayName,
          risk: definition.risk,
          status: needsApproval ? 'requested' : 'running',
          summary: needsApproval ? '等待用户确认' : '正在执行'
        })
        if (needsApproval) {
          if (owner && request.sessionId && CONTACT_ACTION_TOOLS.includes(call.name as ContactActionTool)) {
            if(context.confirmationMode==='await-receipt') {
              if(!context.beforePersistentOffer||!context.waitForActionReceipt)throw new Error('确认回执桥接不可用，未创建事项。')
              await context.beforePersistentOffer(call)
              context.signal.throwIfAborted()
            }
            const card = await context.offerAction(`${request.requestId}:${call.id}`, {
              purpose: 'confirmation', title: definition.displayName, body: `${configurationStep ? `同次设置调整 ${configurationStep.index}/${configurationStep.total}。此项单独确认并保存。\n` : ''}${prepared.preview || definition.description}`,
              sessionId: request.sessionId,
              ...(configurationStep ? { configurationGroup: { id: request.requestId, ...configurationStep } } : {}),
              subject: call.name !== 'set_contact_output_preference' && typeof arguments_.topicId === 'string' && Number.isSafeInteger(arguments_.revision)
                ? { kind: typeof arguments_.deliveryVersion === 'number' ? 'delivery' : 'task', topicId: arguments_.topicId, revision: arguments_.revision, ...(typeof arguments_.deliveryVersion === 'number' ? { version: arguments_.deliveryVersion } : {}) }
                : { kind: 'contact' },
              actions: [{ id: 'apply', label: '确认执行', tool: call.name, arguments: arguments_ }]
              , ...(call.name === 'set_contact_search_credential' ? { input: { label: '搜索密钥', argument: 'credential', maxLength: 8192, required: true } } : {})
            })
            if(context.confirmationMode==='await-receipt')return await context.waitForActionReceipt!(call,card)
            context.emit({ requestId: request.requestId, callId: call.id, name: definition.name, displayName: definition.displayName, risk: definition.risk, status: 'completed', summary: '已发送确认卡片，尚未执行' })
            return JSON.stringify({ pendingInteraction: true, interactionId: card.id, message: '已把需要确认的内容放在聊天卡片中；确认后才会执行。' })
          }
          const outcome = await context.approve(call, prepared.preview)
          if (outcome !== 'approved') {
            const failure = toolApprovalFailure(outcome)
            context.emit({
              requestId: request.requestId,
              callId: call.id,
              name: definition.name,
              displayName: definition.displayName,
              risk: definition.risk,
              status: failure.status,
              summary: failure.summary
            })
            return failure.content
          }
          context.emit({
            requestId: request.requestId,
            callId: call.id,
            name: definition.name,
            displayName: definition.displayName,
            risk: definition.risk,
            status: 'running',
            summary: '已授权，正在执行'
          })
        }
        if (context.signal.aborted) throw new Error('AI 请求已取消。')
        if (!context.getConfig().aiToolsEnabled || !context.isToolEnabled(call.name)) throw new Error('工具已被用户禁用。')
        await context.assertContext()
        context.state.ownMemoryMutation = ['update_contact_memory', 'forget_contact_memory'].includes(call.name) && Boolean(context.state.contactContext?.memories.some(m => m.id === arguments_.id))
        const result = await prepared.execute()
        if (context.state.ownMemoryMutation) { context.state.memoryMutationReceipt = result.summary; context.state.ownMemoryMutation = false; context.cancel() }
        if (call.name === 'read_contact_material' && context.state.contactContext) {
          const ref = JSON.parse(result.content).materialRead as import('../../shared/contact-materials').MaterialReadRef
          context.state.contactContext.materials = [...(context.state.contactContext.materials ?? []), ref]
        }
        context.emit({
          requestId: request.requestId,
          callId: call.id,
          name: definition.name,
          displayName: definition.displayName,
          risk: definition.risk,
          status: 'completed',
          summary: result.summary.slice(0, 500), taskId: result.taskId, taskRefs: result.taskRefs
        })
        return result.content.slice(0, 50_000)
      } catch (error) {
        context.state.ownMemoryMutation = false
        const message = error instanceof Error && error.message ? error.message : 'AI 请求失败，请检查 Provider 配置和网络后重试。'
        context.emit({
          requestId: request.requestId,
          callId: call.id,
          name: definition.name,
          displayName: definition.displayName,
          risk: definition.risk,
          status: 'error',
          summary: message.slice(0, 500)
        })
        return `工具执行失败：${message}`
      }
    }
  }
}
