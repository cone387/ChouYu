import { expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { streamAIChat } from '../ai'
import { routeContactChange } from './chat-changes'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { contactOutputInstruction, sanitizeContactOutput } from '../../shared/contact-output'
import { contactProfileSnapshot } from '../../shared/contact-profile-settings'
import { createDefaultCharacter } from '../../shared/characters'

const enabled = process.env.CHOUYU_CONVERSATION_ACCEPTANCE === '1'
const config = () => JSON.parse(process.env.CHOUYU_ACCEPTANCE_CONFIG || '{}').config
async function model(prompt: string, content: string) {
  let output = ''
  await streamAIChat([{ role: 'user', content }], prompt, config(), text => { output += text }, AbortSignal.timeout(60000), undefined, { timeoutMs: 60000, maxOutputTokens: 2500 })
  return output
}
const save = (name: string, data: unknown) => { mkdirSync('artifacts/contact-conversation/live', { recursive: true }); writeFileSync(`artifacts/contact-conversation/live/${name}.json`, JSON.stringify(data, null, 2)) }
it.skipIf(!enabled)('live cross-domain configuration keeps both requested changes', async () => {
  const calls: any[] = [], decisions: string[] = [], message = '把你的名字改成阿笔，同时关闭你的进展通知，其他都别动。'
  const profile = contactProfileSnapshot({ ...createDefaultCharacter(), id: 'synthetic', builtIn: false, name: '阿文' }, config())
  const reply = await routeContactChange([{ role: 'user', content: message }], {
    configuration: async () => ({ profile, skills: { revision: 1, skills: [] } }), read: async () => ({ settings: DEFAULT_AGENT_SETTINGS, revision: 2, topics: [], runs: [] }),
    model: async (prompt, content) => { const raw = await model(prompt, content); decisions.push(raw); return raw }, execute: async () => { throw new Error('Must prepare independent configuration cards') },
    executeConfigurationStep: async (call, step) => { calls.push({ name: call.name, arguments: JSON.parse(call.arguments), step }); return JSON.stringify({ pendingInteraction: true, interactionId: `step-${step.index}`, message: '已发送卡片' }) }
  })
  save('combination', { message, decisions, calls, reply })
  expect(calls.map(call => call.name).sort()).toEqual(['edit_contact_profile', 'edit_contact_work_settings'])
  expect(calls.find(call => call.name === 'edit_contact_profile').arguments.name).toBe('阿笔')
  expect(calls.find(call => call.name === 'edit_contact_work_settings').arguments.notifyProgress).toBe(false)
}, 65000)
it.skipIf(!enabled).each([
  ['profile', '以后叫你阿笔，人设和其他设置别动。', 'edit_contact_profile'],
  ['permissions', '关闭你的进展通知，允许你共享自己的成果，其他不变。', 'edit_contact_work_settings'],
  ['once', '产品评审这次成果用紧凑间距，只改这版的排版。', 'set_contact_output_preference'],
  ['contact', '今后你的所有成果都用舒适的行文间距。', 'set_contact_output_preference'],
  ['credential', '我要更新你的搜索密钥，给我安全输入入口。', 'set_contact_search_credential'],
  ['discussion', '朋友说应该关闭通知，我还没决定，先聊聊不要改。', undefined]
] as const)('live contact conversation: %s', async (key, message, expected) => {
  const calls: any[] = [], decisions: string[] = []
  const profile = contactProfileSnapshot({ ...createDefaultCharacter(), id: 'synthetic', builtIn: false, name: '阿文' }, config())
  const reply = await routeContactChange([{ role: 'user', content: message }], {
    configuration: async () => ({ profile, skills: { revision: 1, skills: [] }, searchCredential: { revision: 1, configured: false } }),
    read: async (method, args) => method === 'get' ? { settings: DEFAULT_AGENT_SETTINGS, revision: 2, topics: [{ id: 'review', title: '产品评审', revision: 3, goal: '持续评审产品', constraints: '' }], runs: [] } : method === 'delivery' ? { version: 4 } : [{ scope: { kind: 'contact' }, revision: 1, preference: {} }, ...(args?.[0] ? [{ scope: { kind: args?.[1] ? 'delivery' : 'task', topicId: 'review', version: args?.[1] }, revision: 2, preference: {} }] : [])],
    model: async (prompt, content) => { const result = await model(prompt, content); decisions.push(result); return result },
    execute: async call => { calls.push({ name: call.name, arguments: JSON.parse(call.arguments) }); return JSON.stringify({ pendingInteraction: true, message: '验收：待确认卡片' }) }
  })
  save(key, { message, decisions, calls, reply })
  if (!expected) { expect(calls).toEqual([]); return }
  expect(calls).toHaveLength(1); expect(calls[0].name).toBe(expected)
  if (key === 'once') expect(calls[0].arguments).toMatchObject({ scope: 'delivery', deliveryVersion: 4, density: 'compact' })
  if (key === 'contact') expect(calls[0].arguments).toMatchObject({ scope: 'contact', density: 'comfortable' })
  if (key === 'profile') { expect(calls[0].arguments.name).toBe('阿笔'); expect(calls[0].arguments.soulMd).toBeUndefined() }
  if (key === 'permissions') expect(calls[0].arguments).toMatchObject({ notifyProgress: false, shareDeliveries: true })
}, 65000)
it.skipIf(!enabled).each([
  ['writing', '写一段雨夜推门的小说正文'], ['ideas', '提出两个改善会议记录的产品想法'], ['review', '评审一份没有验证付费意愿就大规模投放的计划'],
  ['research', '写一份产品定价调研报告：资料A已核实个人版免费，资料B已核实团队版收费；将证据、未知项和后续核实问题分开列出，保留来源标记[资料A][资料B]。'], ['plan', '为一天内完成访谈准备制定可执行步骤'], ['briefing', '晨报：昨晚初稿已保存，今天等用户确认访谈对象']
] as const)('live output selection: %s', async (kind, request) => {
  const raw = await model(`只返回JSON：{"delivery":{"section":{"body":"完整正式正文","output":{"kind":"...","density":"comfortable"}}}}。不执行任何操作。${contactOutputInstruction}`, request)
  save(`output-${kind}`, { request, raw })
  const result = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''))
  expect(sanitizeContactOutput(result.delivery.section.output)?.kind).toBe(kind)
  expect(result.delivery.section.body.length).toBeGreaterThan(20)
}, 65000)
