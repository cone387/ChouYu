import { expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { streamNativeChat } from '../harness/native/runner'
import { DEFAULT_APP_CONFIG } from '../../shared/config'
import { resolveCharacterConfig } from '../../shared/characters'
import type { AIResponseMetadata } from '../../shared/ai-usage'
import { routineSummaryInstruction, routineSummaryInput, savedDeliveryEvidence } from './companion-summary'

// Paid prompt/consumer regression: real provider, synthetic read-only tool evidence.
// This does not stand in for the separately exercised real scheduled service.
it.skipIf(!process.env.CHOUYU_BRIEFING_ACCEPTANCE)('live briefing does not certify a 598-character draft against a 300–500 word requirement from metadata alone', async () => {
  const data = JSON.parse(process.env.CHOUYU_ACCEPTANCE_CONFIG!), resolved = resolveCharacterConfig(data.characters[0], data.config)
  if (!resolved.ok) throw Error('验收模型不可用')
  const config = { ...DEFAULT_APP_CONFIG, ...data.config, ...resolved.config }
  const metadata = savedDeliveryEvidence({ version: 1, latestVersion: 1, createdAt: Date.now(), savedSectionCount: 1, savedTextLength: 598,
    completionCriteria: '每个日历期次交付一段300至500字正文并正式保存，不结束整个重复任务',
    stages: [{ id: 'chapter1', title: '第一章', status: 'active' }], directory: [{ id: 'opening', title: '蓝灯之夜·抵达', characters: 598 }] })
  const evidence = { checkedAt: new Date().toISOString(), timeZone: 'Asia/Shanghai', contacts: [{ id: 'writer', name: '验收作者',
    topics: [{ id: 'story', title: '灯塔故事', status: 'researching', judgement: '首次交付约480字，符合300至500字要求。', nextStep: '续写', workState: { code: 'scheduled', label: '等待计划时间', description: '等待下一次日历期次' } }],
    runs: [{ topicId: 'story', status: 'completed', summary: '开篇已保存' }], pendingInteractions: [], reports: [] }] }
  let output = '', rounds = 0, reads = 0
  const usage: AIResponseMetadata[] = []
  try {
    await streamNativeChat([{ role: 'user', content: JSON.stringify(routineSummaryInput('检查作者实际工作与正式成果，简短告诉我真正交付了什么。没有正文不能声称交付，未完整读过原文不要评价质量，不替任何人答复或更改工作。', Date.now(), undefined, evidence)) }],
      routineSummaryInstruction('你是用户的专属助手 ChouYu。'), config, chunk => { output += chunk }, AbortSignal.timeout(100000), {
        definitions: [{ name: 'read_contact_delivery', displayName: '核实正式成果', source: 'builtin', risk: 'read', requiresConfirmation: false,
          description: '核实正式保存版本、目录与累计字符数，不读取正文，不执行验收。',
          inputSchema: { type: 'object', properties: { characterId: { type: 'string' }, topicId: { type: 'string' } }, required: ['characterId', 'topicId'], additionalProperties: false } }],
        execute: async call => {
          expect(call.name).toBe('read_contact_delivery')
          expect(JSON.parse(call.arguments)).toEqual({ characterId: 'writer', topicId: 'story' })
          if (++reads > 2) throw Error('验收读取次数超过固定上限')
          return JSON.stringify(metadata)
        }
      }, { timeoutMs: 90000, maxOutputTokens: 1500, beforeRound: () => { if (++rounds > 3) throw Error('验收模型轮次超过固定上限'); return 1500 }, onMetadata: value => { if (value.usage || value.finishReason) usage.push(value) } })
    expect(reads).toBeGreaterThan(0)
    expect(output).toMatch(/保存.*(?:1|一).*节|(?:1|一).*节.*保存/)
    expect(output).toMatch(/未.{0,25}(?:核对|验收|验证)|(?:不能|无法).{0,25}(?:判断|确认|断言)/)
    expect(output).not.toMatch(/598.{0,30}(?:符合|满足)每期/)
    expect(output).not.toMatch(/UTF-16|evidence|verification|workState|completed/)
    // Full natural language is manually reviewed as well: regex alone cannot prove semantic truth.
  } finally {
    mkdirSync('artifacts/contact-next', { recursive: true })
    writeFileSync('artifacts/contact-next/live-briefing-evidence.json', JSON.stringify({ model: config.model, metadata, evidence, rounds, reads, output, usage }, null, 2))
  }
}, 115000)

it.skipIf(!process.env.CHOUYU_BRIEFING_ACCEPTANCE)('live midnight briefing distinguishes same-day and next-day retries in the check time zone', async () => {
  const data = JSON.parse(process.env.CHOUYU_ACCEPTANCE_CONFIG!), resolved = resolveCharacterConfig(data.characters[0], data.config)
  if (!resolved.ok) throw Error('验收模型不可用')
  const config = { ...DEFAULT_APP_CONFIG, ...data.config, ...resolved.config }
  const evidence = { checkedAt: '2026-10-13T16:56:00Z', timeZone: 'Asia/Shanghai', contacts: [
    { name: '验收作者', topics: [{ title: '灯塔故事', status: 'researching', workState: { code: 'retry', label: '等待重试', description: '最早 2026/10/14 01:06:52 自动尝试；仍受工作时间和额度限制。' } }],
      runs: [{ status: 'failed', error: '正文篇幅修订未通过校验。' }], savedDelivery: savedDeliveryEvidence({ version: null, savedSectionCount: 0 }) },
    { name: '验收评审', topics: [{ title: '独立评审', status: 'researching', workState: { code: 'retry', label: '等待重试', description: '最早 2026/10/15 01:08:00 自动尝试；仍受工作时间和额度限制。' } }],
      runs: [{ status: 'failed', error: '模型服务暂时不可用。' }], savedDelivery: savedDeliveryEvidence({ version: null, savedSectionCount: 0 }) }
  ] }
  const input = routineSummaryInput('请按联系人各用一小段汇报当前阻塞、正式交付情况与最早重试时间，时间带上日期或今天/明天，保留工作时段和额度条件。', Date.parse('2026-10-13T15:56:00Z'), undefined, evidence)
  let output = ''
  const usage: AIResponseMetadata[] = []
  try {
    await streamNativeChat([{ role: 'user', content: JSON.stringify(input) }], routineSummaryInstruction('你是用户的专属助手 ChouYu。'), config,
      chunk => { output += chunk }, AbortSignal.timeout(100000), undefined,
      { timeoutMs: 90000, maxOutputTokens: 1000, onMetadata: value => { if (value.usage || value.finishReason) usage.push(value) } })
    const authorStart = output.indexOf('验收作者'), reviewerStart = output.indexOf('验收评审')
    expect(authorStart).toBeGreaterThanOrEqual(0)
    expect(reviewerStart).toBeGreaterThan(authorStart)
    const author = output.slice(authorStart, reviewerStart), reviewer = output.slice(reviewerStart)
    expect(author).toMatch(/今天|今日|10月14日|10[/-]14/)
    expect(author).not.toMatch(/明天|明日|10月15日|10[/-]15/)
    expect(author).toMatch(/0?1[:：]06|1点0?6/)
    expect(reviewer).toMatch(/明天|明日|10月15日|10[/-]15/)
    expect(reviewer).toMatch(/0?1[:：]08|1点0?8/)
    expect(output).toMatch(/工作(?:时间|时段)/)
    expect(output).toMatch(/额度/)
    expect(output).not.toMatch(/UTC|workState|researching|retry|failed/)
    expect(output).not.toMatch(/到时间后会自动再试|我再跟进/)
  } finally {
    mkdirSync('artifacts/contact-next', { recursive: true })
    writeFileSync('artifacts/contact-next/live-briefing-clock.json', JSON.stringify({ model: config.model, input, output, usage }, null, 2))
  }
}, 115000)
