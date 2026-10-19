import { TokenBudgetError } from '../agents/token-budget'
import { createMaterialTools } from '../agents/material-tools'
import { MaterialReferenceError, withMaterialReferenceRepair } from '../agents/material-reference-repair'
import type { ToolExecutionContext } from '../tools/registry'
import { SkillRunner } from '../skills/runner'
import { skillToolRuntime } from '../skills/tools'
import type { SkillSnapshot } from '../../shared/skills'
import { DEFAULT_APP_CONFIG } from '../../shared/config'
import type { HarnessRegistry } from '../harness/registry'
import { ContactTaskStore } from '../task-center/contact-store'
import { type AgentModel } from './workflow'
import type { AIResponseMetadata } from '../../shared/ai-usage'
import { AGENT_OUTPUT_TOKENS, AgentOutputTruncatedError } from '../agents/model-output'

import type { ContactIdentity } from '../contact-agent/contracts'
type Run = NonNullable<ReturnType<ContactTaskStore['getRun']>>
export function createWorkModel(context: {
  store: ContactTaskStore; identity: ContactIdentity; run: Run; input: any; skillRunner: SkillRunner; harnesses: HarnessRegistry
  modelFactory?: (identity: ContactIdentity) => AgentModel
  changed(id: string): void
  request(method: string, owner: string, args: unknown[]): Promise<any>
}): AgentModel {
  const { store, identity, run, input, skillRunner, modelFactory, changed, request } = context
    const skills = input.skills as SkillSnapshot
    const testModel = modelFactory?.(identity)
    let recordedMemoryContext = false
    const recordMemoryContext = () => { if (!recordedMemoryContext) { store.recordMemoryContext(run.id); recordedMemoryContext = true } }
    const model: AgentModel = async (prompt, signal, options) => {
      if (skills.error) throw new Error(`联系人技能不可用：${skills.error}`)
      prompt = skills.instruction ? `${skills.instruction}\n${prompt}` : prompt
      if (input.materialDirectory.length) prompt += `\n本轮资料目录（尚未读取正文；需使用 read_contact_material 工具读取实际版本后引用）：${JSON.stringify(input.materialDirectory)}`
      let output = ''
      let callId: number | undefined, reservation: { key: string; maxOutputTokens: number } | undefined
      let metadata: AIResponseMetadata = { model: identity.config!.model }
      const beforeRound = (round: number, serializedInput: string) => {
        signal.throwIfAborted()
        if (round > 0) store.charge(run.id)
        callId = store.latestCallId(run.id)
        if (callId === undefined) throw new Error('Missing model call record')
        const next = store.tokens.reserve(run.id, callId, run.character_id, run.topic_id, serializedInput, AGENT_OUTPUT_TOKENS)
        if ('error' in next) { store.db.prepare('DELETE FROM calls WHERE id=?').run(callId); callId = undefined; throw new TokenBudgetError(next.error) }
        reservation = { key: next.key!, maxOutputTokens: next.maxOutputTokens! }
        metadata = { model: identity.config!.model }; output = ''
        return reservation.maxOutputTokens
      }
      const afterRound = () => {
        if (!reservation || callId === undefined) return
        store.recordCallMetadata(callId, metadata)
        store.tokens.settle(reservation.key, metadata)
        reservation = undefined; changed(run.character_id)
      }
      const skillRuntime = skillToolRuntime(identity.id, skills, skillRunner, signal, async (skillId, files) => {
        signal.throwIfAborted(); store.assertLive(run.id)
        if (!run.topic_id) throw new Error('工作文件缺少任务来源。')
        return store.files.archive({ characterId: identity.id, skillId, runId: run.id, topicId: run.topic_id, requestId: run.id }, files)
      })
      const materialTools = createMaterialTools({ owner: () => identity.id, request: async (method, owner, args) => {
        store.assertLive(run.id)
        if (method === 'materialList') return input.materialDirectory
        const reference = args[1] as import('../../shared/contact-materials').MaterialRef
        if (!reference || !input.materialDirectory.some((m: import('../../shared/contact-materials').MaterialRef) => m.id === reference.id && m.version === reference.version)) throw new MaterialReferenceError()
        return request(method, owner, [{ query: '', topicId: run.topic_id || undefined }, ...args.slice(1)])
      } })
      const tools = options?.tools !== false && identity.skillToolsEnabled ? { definitions: [...skillRuntime.definitions, ...materialTools], execute: withMaterialReferenceRepair(async (call: import('../../shared/tools').AIToolCall) => {
        signal.throwIfAborted(); store.assertLive(run.id)
        const material = materialTools.find(t => t.name === call.name)
        if (!material) return skillRuntime.execute(call)
        const result = await material.execute({ ...JSON.parse(call.arguments), topicId: run.topic_id || undefined }, {} as ToolExecutionContext)
        if (call.name === 'read_contact_material') store.recordMaterialRead(run.id, JSON.parse(result.content).materialRead)
        return result.content
      }) } : undefined
      if (tools) {
        tools.definitions = tools.definitions.filter(tool => !identity.disabledSkillTools?.includes(tool.name))
        const execute = tools.execute
        tools.execute = call => {
          if (tools.definitions.some(tool => tool.name === call.name)) return execute(call)
          if (identity.disabledSkillTools?.includes(call.name)) return Promise.resolve('工具已被用户禁用。')
          if (['read_contacts', 'discover_contacts'].includes(call.name)) return Promise.resolve(input.settings.readContactDeliveries
            ? '这不是可调用工具，而是工作计划 JSON 的 action 值。尚未读取正文。请结束工具调用，按当前工作指令返回完整计划 JSON；read_contacts 的 contactRefs 必须逐字使用 sharedContactDeliveries 目录中的 ref，urls 填 []。系统校验计划后执行读取，再提供实际正文。不要用 read_contact_material 读取共享成果；当前任务具有共享成果读取权限。'
            : '这不是可调用工具；当前任务未授权读取联系人的共享成果，尚未读取正文。')
          return Promise.resolve('当前工具列表中不存在这个工具，未执行任何操作。请仅使用实际提供的工具或按工作指令返回结果。')
        }
      }
      try {
        if (testModel) { beforeRound(0, prompt); const result = await testModel(prompt, signal, options); if (options?.suppliesMemories) recordMemoryContext(); return result }
        await context.harnesses.background(input.backgroundHarnessEngine).run({ characterId: identity.id, requestId: run.id, messages: [{ role: 'user', content: prompt }],
          systemPrompt: options?.plainText ? 'Output the requested plain text, without JSON.' : 'Follow the work instruction and return JSON. Distinguish facts, assumptions, and sources.',
          config: { ...DEFAULT_APP_CONFIG, ...identity.config! }, signal, tools,
          onChunk: chunk => { output += chunk; options?.onPartial?.(output.slice(0, 24000)); if (output.length > 24000) throw new AgentOutputTruncatedError(output.slice(0, 24000)) },
          options: { timeoutMs: 180000, maxOutputTokens: AGENT_OUTPUT_TOKENS, beforeRound, afterRound, onMetadata: value => { metadata = { ...value, model: value.model || identity.config!.model }; if (options?.suppliesMemories) recordMemoryContext() } } })
        if (metadata.finishReason === 'length' || metadata.finishReason === 'max_tokens') throw new AgentOutputTruncatedError(output)
      } finally { afterRound() }
      return output
    }
  return model
}
