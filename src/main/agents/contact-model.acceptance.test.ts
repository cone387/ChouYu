import { expect, it } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { streamAIChat } from '../ai'
import { resolveCharacterConfig } from '../../shared/characters'
import { contactWorkInstructions } from '../../shared/contact-work-instructions'
import { createContactTools } from './tools'
import { DEFAULT_APP_CONFIG } from '../../shared/config'
import { AgentStore } from './store'
import { AgentRuntime } from './runtime'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'

// Explicit opt-in only. Reads model configuration; never reads chats or writes user data.
it.skipIf(!process.env.CHOUYU_CONTACT_MODEL_ACCEPTANCE)('real contact model reads delivery before requesting a style change despite misleading old chat', async () => {
  const data = JSON.parse(process.env.CHOUYU_ACCEPTANCE_CONFIG || readFileSync(join(process.env.APPDATA!, 'chouyu', 'chouyu-data.json'), 'utf8'))
  const character = data.characters.find((c: { id: string }) => c.id === 'preset-copywriter-bi')
  const resolved = resolveCharacterConfig(character, data.config)
  if (!resolved.ok) throw new Error('阿笔模型配置不可用')
  const calls: string[] = [], requests: unknown[] = []
  let output = ''
  const definitions = createContactTools({ owner: () => 'writer', request: async () => { throw new Error('Acceptance uses synthetic fixtures only') } })
  await streamAIChat([
    { role: 'assistant', content: '十章已经全部写完了。但我不能修改联系人那边的阅读样式。' },
    { role: 'user', content: '这是之前的说法。请先核实正式成果到底存了几章，再把小说成果展示改为跟系统亮色主题一致，保留正文。' }
  ], `${resolved.config.soulMd}\n${contactWorkInstructions}`, { ...DEFAULT_APP_CONFIG, ...data.config, ...resolved.config }, chunk => { output += chunk }, AbortSignal.timeout(150000), {
    definitions,
    execute: async call => {
      calls.push(call.name)
      if (calls.length > 5) throw new Error('验收工具调用超出限定次数')
      const args = JSON.parse(call.arguments)
      if (call.name === 'get_contact_topics') return JSON.stringify({ topics: [{ id: 'novel', revision: 3, title: '玄幻小说', status: 'researching' }], focusTopicId: 'novel', pending: [] })
      if (call.name === 'get_contact_delivery') return JSON.stringify({ version: 4, savedSectionCount: 4, directory: [{ id: 'ch01a', title: '第一章上' }, { id: 'ch01b', title: '第一章下' }, { id: 'ch02a', title: '第二章上' }, { id: 'ch02b', title: '第二章下' }], ...(args.sectionId ? { section: { id: args.sectionId, title: args.sectionId.startsWith('ch01') ? '第一章' : '第二章', body: '验收用合成正文，正式成果只存了前两章。' } } : {}), presentation: { title: '夜读', html: '<div id="content"></div>', css: 'body{background:#111;color:#ddd}', script: '' } })
      if (call.name === 'revise_contact_presentation') {
        requests.push(args)
        return JSON.stringify({ requestAccepted: true, workCompleted: false, baseVersion: 4, run: { status: 'queued' }, message: '样式修订已提交，尚未保存新版本。' })
      }
      throw new Error('模型误选了会改变任务内容的工具：' + call.name)
    }
  }, { timeoutMs: 150000, maxOutputTokens: 2500 })
  mkdirSync('artifacts', { recursive: true })
  writeFileSync('artifacts/contact-model-acceptance.json', JSON.stringify({ model: resolved.config.model, calls, requests, output }, null, 2), 'utf8')
  expect(calls.indexOf('get_contact_topics')).toBeGreaterThanOrEqual(0)
  expect(calls.indexOf('get_contact_delivery')).toBeGreaterThanOrEqual(0)
  expect(calls.indexOf('revise_contact_presentation')).toBeGreaterThan(calls.indexOf('get_contact_delivery'))
  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({ topicId: 'novel', revision: 3, deliveryVersion: 4 })
  expect(output).toMatch(/已提交|排队|尚未|还没/)
  // Generated natural language is also reviewed in the JSON artifact; negations are not completion claims.
}, 160000)

it.skipIf(!process.env.CHOUYU_CONTACT_MODEL_ACCEPTANCE)('real model produces a saved style revision while code preserves synthetic prose', async () => {
  const data = JSON.parse(process.env.CHOUYU_ACCEPTANCE_CONFIG!)
  const resolved = resolveCharacterConfig(data.characters[0], data.config)
  if (!resolved.ok) throw new Error('阿笔模型配置不可用')
  const directory = mkdtempSync(join(tmpdir(), 'chouyu-live-style-'))
  const store = new AgentStore(join(directory, 'agents.db')), runtime = new AgentRuntime(store, join(directory, 'checkpoints.db'))
  try {
    store.save('writer', { ...DEFAULT_AGENT_SETTINGS, goal: '写一篇小说', sources: [], dailyCalls: 5 })
    const topicId = store.overview('writer').focusTopicId!, first = store.createRun('writer', '')
    store.finish(first, { runId: first, title: '雨停之前', body: '首章已保存', nextStep: '继续写作', evidence: [], createdAt: Date.now() }, [],
      { judgement: '首章已保存', nextStep: '继续写作', reason: '写作', openQuestions: '', status: 'researching' },
      { completionCriteria: '完成短篇', summary: '雨停之前', stages: [{ id: 'draft', title: '写作', status: 'active' }], section: { id: 'ch01', title: '第一章 · 雨停之前', body: '雨从傍晚开始下。林音合上书，听见窗外有人轻轻叩门。\n\n她没有立刻起身。那本书的最后一页，原本是一张空白的纸。现在，上面多了一行字：请在雨停之前回来。' }, presentation: { title: '旧夜读', html: '<div id="content"></div>', css: 'body{background:#111;color:#ddd}', script: '' } })
    const before = store.deliveries.get(topicId)!, topic = store.topics.get('writer', topicId)
    const run = store.revisePresentation('writer', topicId, topic.revision, '跟随系统亮色，作家小说阅读排版，舒适字号行距，保留正文，提供调整字号的交互', '', 1)
    await runtime.execute(run, resolved.config.soulMd, async (prompt, signal) => {
      let raw = ''
      await streamAIChat([{ role: 'user', content: prompt }], '按要求输出完整 JSON。', { ...DEFAULT_APP_CONFIG, ...data.config, ...resolved.config }, chunk => { raw += chunk }, signal, undefined, { timeoutMs: 90000, maxOutputTokens: 8192 })
      return raw
    }, AbortSignal.timeout(120000))
    const result = store.deliveries.get(topicId)!
    expect(store.getRun(run)?.status).toBe('completed')
    expect(result.version).toBe(2); expect(result.sections).toEqual(before.sections)
    expect(store.topics.get('writer', topicId).status).toBe(topic.status)
    writeFileSync('artifacts/contact-model-delivery.json', JSON.stringify(result, null, 2), 'utf8')
  } finally { runtime.close(); store.close(); rmSync(directory, { recursive: true, force: true }) }
}, 130000)
