import { expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { WorkLoopHost } from '../agent-space/workloop-host'
import { createBackgroundHarnesses } from '../harness/background'
import { HarnessRegistry } from '../harness/registry'
import { resolveCharacterConfig } from '../../shared/characters'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import type { AIResponseMetadata } from '../../shared/ai-usage'

// Paid opt-in. Only the configured connection is inherited. Every task, memory,
// interview and feedback below is synthetic; no real contact work is changed.
const enabled = process.env.CHOUYU_AUTONOMY_ACCEPTANCE === '1'
const engines = (['native', 'dsh'] as const).filter(engine => !process.env.CHOUYU_AUTONOMY_ENGINE || process.env.CHOUYU_AUTONOMY_ENGINE === engine)
const rejected = '二手玩具寄售这个方向先停止：我不愿承担实物保管、清洁和退货，不要再推荐需要这些工作的方案。技术产品与非技术服务都可以继续想。'
const counterevidence = '合成案例回访记录：3位独立书店店主都表示现有免费表格足够，不愿为通用活动报名工具付费。临时缺席和活动信息重复分发是他们提到的麻烦，但尚未验证愿不愿意为解决这些麻烦付费。'
const hypothesis = '尚未验证的旧假设：独立书店愿意每月付费购买通用活动报名工具；这只是我之前的猜测，没有付款或访谈依据。'
type Trace = { stage: string; prompt: string; output: string; tools: { name: string; arguments: unknown; result?: unknown; error?: string }[]; usage: AIResponseMetadata[] }

it.skipIf(!enabled).each(engines)('%s real model recalls old rejection and counterevidence before proposing a new earning idea', async engine => {
  const data = JSON.parse(process.env.CHOUYU_ACCEPTANCE_CONFIG!)
  if (!data.characters?.[0]) throw new Error('缺少用于验收的联系人模型配置。')
  const resolved = resolveCharacterConfig(data.characters[0], data.config)
  if (!resolved.ok) throw new Error('联系人模型配置不可用。')
  const directory = mkdtempSync(join(tmpdir(), 'chouyu-autonomy-live-'))
  const traces: Trace[] = []
  const open = () => {
    const base = createBackgroundHarnesses({ home: join(directory, 'dsh'), node: process.execPath, helper: resolve('runtime/dsh/helper.mjs') })
    const harnesses = new HarnessRegistry(base.all().map(module => ({ ...module, background: module.background ? { run: async input => {
      const prompt = input.messages.at(-1)?.content ?? ''
      const trace: Trace = { stage: prompt.startsWith('为联系人的同一个事项') ? 'planning' : 'generation', prompt, output: '', tools: [], usage: [] }
      traces.push(trace)
      const tools = input.tools
      let metadata: AIResponseMetadata = {}
      await module.background!.run({ ...input, onChunk: (chunk, done) => { trace.output += chunk; input.onChunk(chunk, done) },
        options: { ...input.options, beforeRound: async (round, serialized) => { metadata = {}; return input.options?.beforeRound?.(round, serialized) },
          onMetadata: value => { metadata = { ...metadata, ...value }; input.options?.onMetadata?.(value) },
          afterRound: async () => { trace.usage.push(metadata); await input.options?.afterRound?.() } },
        tools: tools ? { ...tools, execute: async call => {
          let args: unknown = call.arguments
          try { args = JSON.parse(call.arguments) } catch { /* Preserve malformed input for the real tool to handle. */ }
          const entry: Trace['tools'][number] = { name: call.name, arguments: args }; trace.tools.push(entry)
          try { const result = await tools.execute(call); try { entry.result = JSON.parse(result) } catch { entry.result = result }; return result }
          catch (error) { entry.error = error instanceof Error ? error.message : String(error); throw error }
        } } : undefined })
    } } : undefined })))
    return new WorkLoopHost(join(directory, 'contacts'), () => {}, undefined, undefined, undefined, undefined, undefined, { harnesses })
  }
  let host = open(), runId = '', topicId = '', output = '', candidateId = '', earlyFeedbackId = 0, acceptancePassed = false, failure = ''
  const identity = { id: 'autonomy-fixture', name: '合成验收联系人', soul: '你是独立思考的联系人，直接提出想法并解释依据，明确区分事实与假设。', conversation: '',
    config: { ...resolved.config, thinkingDisabledModels: data.config.thinkingDisabledModels }, skillToolsEnabled: false, backgroundHarnessEngine: engine }
  try {
    await host.sync([identity])
    host.store.save(identity.id, { ...DEFAULT_AGENT_SETTINGS, enabled: false, searchEnabled: false, dailyCalls: 18, dailyTokenLimit: 180000, intervalMinutes: 15,
      goal: '持续为我构思有希望赚钱的点子，技术产品和非技术服务都可以。结合已保存的尝试、用户反馈和研究记录选择下一步，避免重复已否定的方向；只提出想法与验证建议，不实际开展运营。本次所有既有记录均为合成演练案例，不代表真实市场事实，无需查询真实市场。' })
    topicId = host.store.overview(identity.id).focusTopicId!
    const progress = { status: 'researching' as const, judgement: '已保存合成案例记录', openQuestions: '', nextStep: '继续构思想法', reason: '持续任务' }
    const publish = (id: string, title: string, body: string, memories: string[] = [], queued?: string) => {
      const run = queued ?? host.store.createRun(identity.id, '', Date.now(), topicId)
      host.store.finish(run, { runId: run, title, body: '已保存合成记录', nextStep: '继续打磨书店付费报名工具', evidence: [], createdAt: Date.now() }, memories, progress,
        { completionCriteria: '按用户目标持续提出有价值的新想法', summary: '已有几轮构思与回访记录，下一轮需据历史选择方向。', stages: [{ id: 'ideas', title: '构思与核对', status: 'active' }], section: { id, title, body } })
      return run
    }
    publish('toy', '二手玩具寄售初稿', '合成旧方案：把闲置玩具收来清洁、保管、寄售，赚佣金。这是待验证的商业想法。', [hypothesis])
    const feedback = host.store.feedbackLedger.submit(identity.id, { requestId: 'old-rejection', topicId, revision: host.store.topics.get(identity.id, topicId).revision, version: 1, action: 'revise', reason: rejected })
    earlyFeedbackId = feedback.feedbackId
    publish('toy_decision', '寄售方案调整记录', '已收到对寄售初稿的修改意见，该方向暂停；具体理由保留在原成果反馈中。', [], feedback.runId)
    publish('book_probe', '书店报名需求回访', counterevidence)
    for (let index = 4; index <= 7; index++) {
      publish(`notes${index}`, `构思整理${index}`, '合成记录：本轮仅整理思考方法，没有增加市场事实、客户承诺或验证结果。下一轮继续提出有依据的想法。')
      if (index < 7) host.store.feedbackLedger.submit(identity.id, { requestId: `format-${index}`, topicId, revision: host.store.topics.get(identity.id, topicId).revision, version: index, action: 'accept', reason: `第${index}版这种简短表达可以保留。` })
    }
    candidateId = host.store.memoryLibrary.list(identity.id).find(memory => memory.content === hypothesis)!.id
    host.store.memoryLibrary.create(identity.id, { content: '用户愿意考虑技术产品和非技术服务，不只寻找软件产品。', kind: 'preference', scope: { kind: 'task', topicId }, source: { kind: 'user', at: Date.now() } })
    host.store.setTaskBudget(identity.id, topicId, host.store.topics.get(identity.id, topicId).revision, { modelCalls: 18, tokens: 180000, reason: '本次隔离场景验收' })
    await host.close(); host = open(); await host.sync([identity])
    await host.request('run', identity.id, [topicId])
    runId = host.store.overview(identity.id).runs[0].id
    await vi.waitFor(() => expect(['completed', 'failed', 'waiting', 'cancelled']).toContain(host.store.getRun(runId)?.status), { timeout: 235000, interval: 500 })
    const detail = host.store.detail(identity.id, runId)
    const artifact = host.store.deliveries.get(topicId)
    output = artifact?.runId === runId ? artifact.sections.at(-1)?.body ?? '' : ''
    expect(detail.run.status, detail.run.error).toBe('completed')
    const input = JSON.parse(host.store.getRun(runId)!.input)
    expect(input.taskContext.recentFeedback.every((item: { id: number }) => item.id !== earlyFeedbackId)).toBe(true)
    expect(traces[0].prompt).not.toContain(counterevidence)
    expect(traces[0].prompt).not.toContain(rejected)
    expect(traces[0].prompt).not.toContain(hypothesis)
    // Search snippets are genuinely supplied context too. A short record can fit
    // entirely in a snippet; do not force redundant read calls to inflate success.
    type Retrieved = { ref?: { kind: string; id: string }; status?: string; items?: Retrieved[] }
    const retrieved = traces.flatMap(trace => trace.tools).flatMap(tool => { const result = tool.result as Retrieved | undefined; return result?.items ?? (result?.ref ? [result] : []) })
    expect(retrieved.some(item => item.ref?.kind === 'deliveries' && item.ref.id === 'book_probe')).toBe(true)
    expect(retrieved.some(item => item.ref?.kind === 'feedback' && item.ref.id === String(earlyFeedbackId))).toBe(true)
    expect(retrieved.some(item => item.ref?.kind === 'memories' && item.ref.id === candidateId && item.status === 'candidate')).toBe(true)
    expect(traces.some(trace => trace.stage === 'planning' && trace.tools.some(tool => ['search_task_context', 'read_task_context'].includes(tool.name)))).toBe(true)
    expect(output.length).toBeGreaterThan(100)
    expect(output).toMatch(/免费表格|不愿.{0,8}付费/)
    expect(output).toMatch(/保管|清洁|退货|寄售/)
    expect(host.store.memoryLibrary.get(identity.id, candidateId).status).toBe('candidate')
    expect(host.store.topics.get(identity.id, topicId).status).toBe('researching')
    expect(detail.run.question).toBe('')
    acceptancePassed = true
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    try {
      const report = { engine, model: resolved.config.model, syntheticOnly: true, acceptancePassed, failure, manualSemanticReviewRequired: true, runId, topicId, earlyFeedbackId, candidateId, output,
        detail: runId ? host.store.detail(identity.id, runId) : undefined, traces }
      mkdirSync('artifacts/agent-autonomy', { recursive: true })
      writeFileSync(`artifacts/agent-autonomy/live-${engine}.json`, JSON.stringify(report, null, 2))
    } finally {
      try { await host.close() } finally { rmSync(directory, { recursive: true, force: true }) }
    }
  }
}, 270000)
