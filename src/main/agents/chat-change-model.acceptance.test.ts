import { expect, it } from 'vitest'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { streamAIChat } from '../ai'
import { resolveCharacterConfig } from '../../shared/characters'
import { routeContactChange } from './chat-changes'

// Explicit opt-in: live model, synthetic tasks only. Never modifies real chats/tasks.
const enabled = Boolean(process.env.CHOUYU_CHAT_CHANGE_ACCEPTANCE)
const cases = [
  ['report-unit', '你怎么一次汇报那么多，一次汇报一个就行了，可以吗？', 'edit_contact_task'],
  ['language', '以后评审都用中文，先给结论，依据也保留。', 'edit_contact_task'],
  ['budget', '这个任务的累计Token上限改成30万，其他不变。', 'edit_contact_task'],
  ['pause', '先暂停这个评审任务。', 'update_contact_topic'],
  ['discussion', '你觉得这个评价标准合理吗？先讨论，不要改。', undefined],
  ['quote', '朋友说“一次汇报一个”，我还没决定，你觉得呢？先不改。', undefined],
  ['unsupported', '从明天起每天上午九点准时评价。', 'question'],
  ['daily-budget', '你的每日Token上限改为30万。', 'question'],
  ['ambiguous', '把那个任务改成中文。', 'question']
] as const
it.skipIf(!enabled).each(cases)('live model routes %s without a verbal-only promise', async (key, message, expected) => {
  const data = JSON.parse(process.env.CHOUYU_ACCEPTANCE_CONFIG || readFileSync(join(process.env.APPDATA!, 'chouyu', 'chouyu-data.json'), 'utf8'))
  const character = data.characters.find((c: { id: string }) => c.id === 'ca2bb3cb-805a-453d-9c3c-d580e130ae5d')
  const resolved = resolveCharacterConfig(character, data.config)
  if (!resolved.ok) throw new Error('验收模型不可用')
  const calls: { name: string; args: any }[] = []
  const tasks = [{ id: 'review', revision: 3, title: '产品评价', goal: '持续评价AI产品idea。可以一次评价1–3个idea。保留依据，不重复评价。', constraints: '只读取真实成果，不修改原作者成果。', status: 'researching' }]
  if (key === 'ambiguous') tasks.push({ ...tasks[0], id: 'another', title: '市场研究' })
  const output = await routeContactChange([{ role: 'user', content: message }], {
    read: async () => ({ topics: tasks, runs: [], focusTopicId: 'review' }),
    model: async (prompt, content) => {
      let result = ''
      await streamAIChat([{ role: 'user', content }], prompt, { ...data.config, ...resolved.config }, chunk => { result += chunk }, AbortSignal.timeout(60000), undefined, { timeoutMs: 60000, maxOutputTokens: 2500 })
      return result
    },
    execute: async call => { calls.push({ name: call.name, args: JSON.parse(call.arguments) }); return JSON.stringify({ saved: true, workCompleted: false, message: '验收夹具保存成功' }) }
  })
  mkdirSync('temp/chat-change-model', { recursive: true })
  writeFileSync(`temp/chat-change-model/${key}.json`, JSON.stringify({ message, calls, output }, null, 2))
  if (expected === 'question') { expect(calls).toHaveLength(0); expect(output).toBeTruthy() }
  else if (!expected) { expect(calls).toHaveLength(0); expect(output).toBeUndefined() }
  else {
    expect(calls).toHaveLength(1); expect(calls[0].name).toBe(expected)
    expect(calls[0].args).toMatchObject({ topicId: 'review', revision: 3, reason: message })
    if (key === 'budget') { expect(calls[0].args.tokens).toBe(300000); expect(calls[0].args.modelCalls).toBeUndefined() }
    if (key === 'pause') expect(calls[0].args.action).toBe('pause')
    if (key === 'report-unit') { expect(calls[0].args.goal).toBeUndefined(); expect(calls[0].args.separateEvaluations).toBe(true) }
  }
}, 65000)
