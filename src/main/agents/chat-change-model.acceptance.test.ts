import { expect, it } from 'vitest'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { streamAIChat } from '../ai'
import { resolveCharacterConfig } from '../../shared/characters'
import { routeContactChange } from './chat-changes'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import type { AIChatMessage } from '../../shared/ai'
import { contactWorkInstructions } from '../../shared/contact-work-instructions'
import { createContactTools } from './tools'

// Explicit opt-in: live model, synthetic tasks only. Never modifies real chats/tasks.
const enabled = Boolean(process.env.CHOUYU_CHAT_CHANGE_ACCEPTANCE)

it.skipIf(!enabled).each([1, 2, 3])('live model follows edited latest request through final prose, sample %i', async sample => {
  const data = JSON.parse(process.env.CHOUYU_ACCEPTANCE_CONFIG || readFileSync(join(process.env.APPDATA!, 'chouyu', 'chouyu-data.json'), 'utf8'))
  const character = data.characters.find((c: { id: string }) => c.id === 'preset-copywriter-bi')
  const resolved = resolveCharacterConfig(character, data.config)
  if (!resolved.ok) throw new Error('验收模型不可用')
  const latest = 'hello 在帮我写一章吞噬星空续看看'
  const decisions: string[] = [], calls: any[] = []
  const messages: AIChatMessage[] = [
    { role: 'user', content: '整体写法' },
    { role: 'assistant', content: '你说的「整体写法」具体想怎么调？比如要加人物心理描写、改变叙事视角、调整节奏等，说一下方向我来改。' },
    { role: 'assistant', content: '第二章·塔与壁\n罗峰在虚空中盘坐下来，星辰塔的纹路渐渐亮起。' },
    { role: 'user', content: latest }
  ]
  const overview = { settings: DEFAULT_AGENT_SETTINGS, topics: [
      { id: 'space', revision: 1, title: '《吞噬星空》同人续写', goal: '续写罗峰的冒险', constraints: '', status: 'paused' },
      { id: 'music', revision: 1, title: '音乐修炼题材玄幻小说', goal: '以音乐修炼为主题写小说', constraints: '', status: 'researching' }
    ], runs: [], focusTopicId: 'music' }
  const output = await routeContactChange(messages, {
    read: async () => overview,
    model: async (prompt, content) => {
      let result = ''
      await streamAIChat([{ role: 'user', content }], prompt, { ...data.config, ...resolved.config }, chunk => { result += chunk }, AbortSignal.timeout(60000), undefined, { timeoutMs: 60000, maxOutputTokens: 2500 })
      decisions.push(result)
      return result
    },
    execute: async call => { calls.push(call); return JSON.stringify({ saved: true, workCompleted: false, message: '验收夹具接收请求' }) }
  })
  let prose = ''
  const toolCalls: { name: string; args: Record<string, unknown> }[] = []
  if (output === undefined) {
    await streamAIChat(messages, `${resolved.config.soulMd}\n${contactWorkInstructions}`, { ...data.config, ...resolved.config }, chunk => { prose += chunk }, AbortSignal.timeout(90000), {
      definitions: createContactTools({ owner: () => 'writer', request: async () => { throw new Error('Only synthetic tool results are allowed') } }),
      execute: async call => {
        const args = JSON.parse(call.arguments)
        toolCalls.push({ name: call.name, args })
        if (toolCalls.length > 5) throw new Error('Too many tool calls for a single chapter request')
        if (call.name === 'get_contact_topics') return JSON.stringify({ ...overview, pending: [] })
        if (call.name === 'get_contact_delivery') {
          expect(args.topicId).toBe('space')
          if (args.sectionId !== undefined) expect(args.sectionId).toBe('ch02')
          if (args.version !== undefined) expect(args.version).toBe(2)
          return JSON.stringify({ version: 2, directory: [{ id: 'ch02', title: '第二章·塔与壁' }], ...(args.sectionId ? { section: { id: 'ch02', title: '第二章·塔与壁', body: messages[2].content } } : {}) })
        }
        throw new Error(`A single chapter request must not change persistent tasks: ${call.name}`)
      }
    }, { timeoutMs: 90000, maxOutputTokens: 5000 })
  }
  mkdirSync('temp/chat-change-model', { recursive: true })
  writeFileSync(`temp/chat-change-model/edited-latest-${sample}.json`, JSON.stringify({ latest, decisions, calls, output, toolCalls, prose }, null, 2))
  // Asking for one chapter is an immediate content request, not authorization
  // to change the paused task's persistent execution state.
  expect(output).toBeUndefined()
  expect(calls).toEqual([])
  expect(prose.length).toBeGreaterThan(800)
  expect(prose).toContain('罗峰')
  expect(prose).not.toMatch(/对吗[？?]|要继续的是|要调哪个任务|具体想怎么调/)
}, 215000)

const cases = [
  ['report-unit', '你怎么一次汇报那么多，一次汇报一个就行了，可以吗？', 'edit_contact_task'],
  ['language', '以后评审都用中文，先给结论，依据也保留。', 'edit_contact_task'],
  ['budget', '这个任务的累计Token上限改成30万，其他不变。', 'edit_contact_task'],
  ['pause', '先暂停这个评审任务。', 'update_contact_topic'],
  ['revise-existing', '这个评审任务已保存的正文结尾太急，把正文重写一版，保留原目标和运行设置。', 'update_contact_topic'],
  ['discussion', '你觉得这个评价标准合理吗？先讨论，不要改。', undefined],
  ['quote', '朋友说“一次汇报一个”，我还没决定，你觉得呢？先不改。', undefined],
  ['daily-schedule', '从明天起每天上午九点准时评价。', 'set_contact_schedule'],
  ['daily-budget', '你的每日Token上限改为30万。', 'edit_contact_work_settings'],
  ['work-hours', '以后只在晚上八点到十一点工作，其他不变。', 'edit_contact_work_settings'],
  ['clear-token', '取消这个任务的Token上限，保留调用上限。', 'edit_contact_task'],
  ['end', '这项任务到这里结束，保留已有成果。', 'update_contact_topic'],
  ['ambiguous', '把那个任务改成中文。', 'question'],
  ['wrong-book', '我说的是继续写吞噬星空续', 'question'],
  ['continue-running', '继续产品评价', 'question'],
  ['continue-waiting', '继续产品评价', 'question'],
  ['continue-free', '继续产品评价', 'update_contact_topic'],
  ['continue-unnamed', '嗯，继续吧', 'update_contact_topic']
] as const
it.skipIf(!enabled).each(cases)('live model routes %s without a verbal-only promise', async (key, message, expected) => {
  const data = JSON.parse(process.env.CHOUYU_ACCEPTANCE_CONFIG || readFileSync(join(process.env.APPDATA!, 'chouyu', 'chouyu-data.json'), 'utf8'))
  const character = data.characters.find((c: { id: string }) => c.id === (process.env.CHOUYU_ACCEPTANCE_CHARACTER || 'ca2bb3cb-805a-453d-9c3c-d580e130ae5d'))
  const resolved = resolveCharacterConfig(character, data.config)
  if (!resolved.ok) throw new Error('验收模型不可用')
  const calls: { name: string; args: any }[] = []
  const decisions: string[] = []
  const tasks = [{ id: 'review', revision: 3, title: '产品评价', goal: '持续评价AI产品idea。可以一次评价1–3个idea。保留依据，不重复评价。', constraints: '只读取真实成果，不修改原作者成果。', status: 'researching' }]
  if (key === 'ambiguous') tasks.push({ ...tasks[0], id: 'another', title: '市场研究' })
  if (key === 'wrong-book') Object.assign(tasks[0], { title: '写一本音乐修炼题材的玄幻小说', goal: '以音乐修炼为核心，节奏爽快，持续写作。' })
  const runs = key === 'continue-waiting' ? [{ id: 'run', topicId: 'review', status: 'waiting', question: '请确定这次评价面向哪个行业？' }]
    : key === 'continue-running' || key === 'wrong-book' ? [{ id: 'run', topicId: 'review', status: 'running', question: '' }] : []
  const output = await routeContactChange([{ role: 'user', content: message }], {
    read: async (method, args) => {
      if (method === 'get') return { revision: 4, settings: { ...DEFAULT_AGENT_SETTINGS, goal: '评价产品' }, topics: tasks, runs, focusTopicId: 'review' }
      if (method === 'outputPreferences') return [{ scope: { kind: 'contact' }, revision: 0, preference: {} }, ...(args?.[0] ? [{ scope: { kind: 'task', topicId: args[0] }, revision: 0, preference: {} }] : [])]
      throw new Error(`Unsupported synthetic read: ${method}`)
    },
    model: async (prompt, content) => {
      let result = ''
      await streamAIChat([{ role: 'user', content }], prompt, { ...data.config, ...resolved.config }, chunk => { result += chunk }, AbortSignal.timeout(60000), undefined, { timeoutMs: 60000, maxOutputTokens: 2500 })
      decisions.push(result)
      mkdirSync('temp/chat-change-model', { recursive: true })
      writeFileSync(`temp/chat-change-model/${key}.json`, JSON.stringify({ message, decisions, calls }, null, 2))
      return result
    },
    execute: async call => {
      const args = JSON.parse(call.arguments); calls.push({ name: call.name, args })
      if (call.name === 'set_contact_output_preference') return JSON.stringify({ saved: true, revision: args.revision + 1, scope: { kind: args.scope, ...(args.topicId ? { topicId: args.topicId } : {}) }, message: '验收夹具保存成功' })
      return JSON.stringify({ saved: true, revision: 5, ...(args.action === 'end' ? { status: 'completed' } : {}), workCompleted: false, message: '验收夹具保存成功' })
    }
  })
  mkdirSync('temp/chat-change-model', { recursive: true })
  writeFileSync(`temp/chat-change-model/${key}.json`, JSON.stringify({ message, decisions, calls, output }, null, 2))
  if (expected === 'question') { expect(calls).toHaveLength(0); expect(output).toBeTruthy() }
  else if (!expected) { expect(calls).toHaveLength(0); expect(output).toBeUndefined() }
  else if (key === 'language' && calls[0]?.name === 'set_contact_output_preference') {
    expect(calls).toHaveLength(1)
    expect(calls[0].args).toMatchObject({ revision: 0, reason: message })
    expect(['task', 'contact']).toContain(calls[0].args.scope)
    if (calls[0].args.scope === 'task') expect(calls[0].args.topicId).toBe('review')
    expect(calls[0].args.instruction).toMatch(/中文/)
    expect(calls[0].args.instruction).toMatch(/结论/)
    expect(calls[0].args.instruction).toMatch(/依据/)
    expect(output).toContain('保存成功')
  } else {
    expect(calls).toHaveLength(1); expect(calls[0].name).toBe(expected)
    expect(calls[0].args).toMatchObject(expected === 'edit_contact_work_settings' ? { revision: 4, reason: message } : { topicId: 'review', revision: 3, reason: message })
    if (key === 'daily-budget') expect(calls[0].args.dailyTokenLimit).toBe(300000)
    if (key === 'work-hours') expect(calls[0].args).toMatchObject({ workStart: '20:00', workEnd: '23:00' })
    if (key === 'clear-token') expect(calls[0].args.clearTokenLimit).toBe(true)
    if (key === 'end') expect(calls[0].args.action).toBe('end')
    if (key === 'budget') { expect(calls[0].args.tokens).toBe(300000); expect(calls[0].args.modelCalls).toBeUndefined() }
    if (key === 'pause') expect(calls[0].args.action).toBe('pause')
    if (key === 'revise-existing') expect(calls[0].args.action).toBe('revise')
    if (key === 'report-unit') { expect(calls[0].args.goal).toBeUndefined(); expect(calls[0].args.separateEvaluations).toBe(true) }
  }
  if (key === 'continue-running') expect(output).toContain('正在执行')
  if (key === 'continue-waiting') expect(output).toContain('请确定这次评价面向哪个行业？')
}, 65000)
