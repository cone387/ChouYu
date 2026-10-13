import { expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { streamAIChat } from '../ai'
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
    await streamAIChat([{ role: 'user', content: JSON.stringify(routineSummaryInput('检查作者实际工作与正式成果，简短告诉我真正交付了什么。没有正文不能声称交付，未完整读过原文不要评价质量，不替任何人答复或更改工作。', Date.now(), undefined, evidence)) }],
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
