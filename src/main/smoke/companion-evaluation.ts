import { CompanionBriefing } from '../assistant-routines/companion'
import { summarizeCompanionWork } from '../assistant-routines/companion-summary'
import { probeConversation } from '../provider-probe'
import type { AppConfig } from '../../shared/config'
import type { AgentRun } from '../../shared/agents'

/** Online opt-in evaluation with synthetic fixtures; never reads or mutates real tasks. */
export async function evaluateCompanion(config: AppConfig) {
  const diagnostic = await probeConversation(config)
  if (diagnostic.state !== 'ready') throw new Error(diagnostic.message)
  let state: string | undefined, calls = 0
  const receipts = new Set<string>(), messages: Array<{ scenario: string; content: string }> = []
  let scenario = 'waiting'
  const topic = { id: 'synthetic-task', revision: 1, title: '测试报告', status: 'researching' as const, judgement: '已保存初稿，尚未验收', reason: '', nextStep: '等待用户选择范围', updatedAt: 1 }
  const run = { topicId: topic.id, status: 'waiting' as AgentRun['status'], question: '只分析国内市场还是包含海外？', error: '', summary: '' }
  const service = new CompanionBriefing({
    read: () => state, write: value => { state = value }, enabled: () => true, allowed: () => true,
    inspect: async () => ({ checkedAt: new Date().toISOString(), timeZone: 'Asia/Shanghai', contacts: [{
      id: 'synthetic-contact', name: '测试联系人', topics: [{ ...topic }], runs: [{ ...run }], omittedTopics: 0, queuedTopicIds: [], reports: [], latestActivity: undefined
    }] }),
    summarize: async (facts, signal) => {
      calls++
      return summarizeCompanionWork(facts.map(f => ({ ...f, savedDelivery: { version: 2, savedSectionCount: 2, savedTextLength: 800 }, evidenceBoundary: '只核实初稿已保存，未读全文，未验收。' })), config, '你是 ChouYu。', signal)
    },
    delivered: receipt => receipts.has(receipt),
    deliver: item => { receipts.add(item.receipt); messages.push({ scenario, content: item.content }) }
  })
  await service.send('greeting', 'evaluation-waiting')
  scenario = 'unchanged'; await service.send('return', 'evaluation-unchanged')
  if (calls !== 1 || !messages[1].content.includes('没有新的变化')) throw new Error('无变化时重复调用模型或错误汇报。')
  scenario = 'failed'; run.status = 'failed'; run.error = '资料接口返回 503，未取得新资料'; run.question = ''; topic.revision++
  await service.send('return', 'evaluation-failed')
  scenario = 'new-draft'; run.status = 'completed'; run.error = ''; topic.judgement = '新增第二节初稿，尚未核对引用，任务未完成'; topic.nextStep = '核对引用'; topic.revision++
  await service.send('return', 'evaluation-draft')
  const count = messages.length
  await service.send('return', 'evaluation-draft')
  if (messages.length !== count || Number(calls) !== 3) throw new Error('重复事件未去重。')
  for (const m of messages.filter(m => m.scenario !== 'unchanged')) {
    if (!m.content.includes('#contact-task?characterId=synthetic-contact&topicId=synthetic-task')) throw new Error('任务链接错误。')
    if (m.content.includes('模型整理失败') || m.content.includes('检查失败或超时')) throw new Error('模型汇报失败。')
    const summary = m.content.split('\n\n')[1] ?? ''
    if (/researching|runStatus|nextStep/.test(summary)) throw new Error('汇报泄露内部状态名。')
    if (m.scenario !== 'waiting' && /需要你|请你|建议|如需|是否要我|你这边/.test(summary)) throw new Error('汇报含未授权的用户行动建议。')
  }
  return { diagnostic, modelCalls: calls, messages, checkedAt: new Date().toISOString(), scope: 'Synthetic task facts with real online model; semantic output requires review.' }
}
