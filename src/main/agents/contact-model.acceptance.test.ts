import { expect, it } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { streamNativeChat } from '../harness/native/runner'
import { resolveCharacterConfig } from '../../shared/characters'
import { contactWorkInstructions } from '../../shared/contact-work-instructions'
import { createContactTools } from './tools'
import { DEFAULT_APP_CONFIG } from '../../shared/config'
import { ContactTaskStore } from '../task-center/contact-store'
import { WorkStrategyRuntime } from '../workloop/workflow'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'

// Explicit opt-in only. Reads model configuration; never reads chats or writes user data.
it.skipIf(!process.env.CHOUYU_CONTACT_MODEL_ACCEPTANCE)('real contact model reads delivery before requesting a style change despite misleading old chat', async () => {
  const data = JSON.parse(process.env.CHOUYU_ACCEPTANCE_CONFIG || readFileSync(join(process.env.APPDATA!, 'chouyu', 'chouyu-data.json'), 'utf8'))
  const character = data.characters.find((c: { id: string }) => c.id === 'preset-copywriter-bi')
  const resolved = resolveCharacterConfig(character, data.config)
  if (!resolved.ok) throw new Error('阿笔模型配置不可用')
  const calls: string[] = [], requests: unknown[] = []
  let output = ''
  const definitions = createContactTools({ owner: () => 'writer', dispatchUnknown: async () => { throw new Error('Acceptance uses synthetic fixtures only') } })
  await streamNativeChat([
    { role: 'assistant', content: '十章已经全部写完了。但我不能修改联系人那边的阅读样式。' },
    { role: 'user', content: '这是之前的说法。请先核实正式成果到底存了几章，再把小说成果展示改为跟系统亮色主题一致，保留正文。' }
  ], `${resolved.config.soulMd}\n${contactWorkInstructions}`, { ...DEFAULT_APP_CONFIG, ...data.config, ...resolved.config }, chunk => { output += chunk }, AbortSignal.timeout(150000), {
    definitions,
    execute: async call => {
      calls.push(call.name)
      if (calls.length > 5) throw new Error('验收工具调用超出限定次数')
      const args = JSON.parse(call.arguments)
      if (call.name === 'get_contact_topics') return JSON.stringify({ topics: [{ id: 'novel', revision: 3, title: '玄幻小说', status: 'researching' }], focusTopicId: 'novel', pending: [] })
      if (call.name === 'get_contact_delivery') return JSON.stringify({ version: 4, savedSectionCount: 4, directory: [{ id: 'ch01a', title: '第一章上' }, { id: 'ch01b', title: '第一章下' }, { id: 'ch02a', title: '第二章上' }, { id: 'ch02b', title: '第二章下' }], ...(args.sectionId ? { section: { id: args.sectionId, title: args.sectionId.startsWith('ch01') ? '第一章' : '第二章', body: '验收用合成正文，正式成果只存了前两章。' } } : {}) })
      if (call.name === 'request_result_design') {
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
  expect(calls.indexOf('request_result_design')).toBeGreaterThan(calls.indexOf('get_contact_delivery'))
  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({ topicId: 'novel', deliveryVersion: 4 })
  expect(output).toMatch(/已提交|排队|尚未|还没/)
  // Generated natural language is also reviewed in the JSON artifact; negations are not completion claims.
}, 160000)
