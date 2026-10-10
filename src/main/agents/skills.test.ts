import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentService, type AgentIdentity } from './service'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { evidenceFromText } from './sources'
import type { SkillSnapshot } from '../../shared/skills'
import { SkillLibrary } from '../skills/library'
import { SkillRunner } from '../skills/runner'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); vi.unstubAllGlobals() })

it('executes an actual background skill file tool and accounts for both model requests', async () => {
  const root = mkdtempSync(join(tmpdir(), 'chouyu-skill-tools-')), source = join(root, 'source')
  mkdirSync(source); writeFileSync(join(source, 'SKILL.md'), '---\nname: Design\n---\nWrite the design to notes/design.md before reporting the result.')
  const library = new SkillLibrary(join(root, 'contact-skills')); library.publish('design', source); library.configure('alice', 'design', 'enable', 0)
  const final = JSON.stringify({ title: '判断', body: '资料 [1] 待核实，设计文件已保存。', nextStep: '继续核实', memories: [], question: '', progress: { judgement: '需求尚待验证', openQuestions: '是否愿意付费', nextStep: '继续核对', reason: '根据资料 [1]', status: 'needs_evidence' } })
  const requests: any[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string); requests.push(body)
    const first = requests.length === 1
    const event = { choices: [{ delta: first ? { tool_calls: [{ index: 0, id: 'save-design', function: { name: 'write_skill_file', arguments: JSON.stringify({ skillId: 'design', path: 'notes/design.md', content: 'verified design content' }) } }] } : { content: final }, finish_reason: first ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }
    return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  }))
  const service = new AgentService(join(root, 'agents'), () => {}, undefined, async () => evidenceFromText('https://example.com/', '事实。'.repeat(60)), undefined, id => library.snapshot(id), library.root)
  cleanups.push(async () => { await service.close(); rmSync(root, { recursive: true, force: true }) })
  await service.sync([{ id: 'alice', soul: 'alice', conversation: '', skillToolsEnabled: true, config: { provider: 'openai', baseUrl: 'https://provider.example/v1', apiKey: 'test', model: 'test', thinkingDisabledModels: [] } }])
  await service.request('save', 'alice', [{ ...DEFAULT_AGENT_SETTINGS, goal: '评审', sources: ['https://example.com/'] }]); await service.request('run', 'alice')
  await vi.waitFor(() => expect(service.store.overview('alice').runs[0]?.status).toBe('completed'))
  expect(requests).toHaveLength(2)
  expect(requests[0].tools.some((tool: any) => tool.function.name === 'write_skill_file')).toBe(true)
  expect(requests[1].messages.find((message: any) => message.role === 'tool').content).toContain('notes/design.md')
  expect(new SkillRunner(library).readFile('alice', library.snapshot('alice'), 'design', 'notes/design.md', 'workspace')).toBe('verified design content')
  expect(service.store.callCount('alice')).toBe(2)
  expect(service.store.tokens.usage('alice').today).toBe(60)
})
it('saves the owning contact skill snapshot and does not cancel a run when skills change', async () => {
  const root = mkdtempSync(join(tmpdir(), 'chouyu-skill-runs-'))
  const calls: { id: string; prompt: string; signal: AbortSignal; resolve: (text: string) => void }[] = []
  let latest: SkillSnapshot | undefined
  const service = new AgentService(root, () => {}, identity => (prompt, signal) => new Promise((resolve, reject) => {
    calls.push({ id: identity.id, prompt, signal, resolve }); signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
  }), async () => evidenceFromText('https://example.com/', '需求事实。'.repeat(40)), undefined, id => latest ?? { entries: [{ id: `${id}-review`, digest: 'a'.repeat(64) }], instruction: `${id} 的独立技能正文` })
  cleanups.push(async () => { await service.close(); rmSync(root, { recursive: true, force: true }) })
  const identities: AgentIdentity[] = ['alice', 'bob'].map(id => ({ id, soul: id, conversation: '', config: { provider: 'openai', baseUrl: 'https://example.com', apiKey: 'test', model: 'test', thinkingDisabledModels: [] }, skills: { entries: [{ id: `${id}-review`, digest: 'a'.repeat(64) }], instruction: `${id} 的独立技能正文` } }))
  await service.sync(identities)
  for (const id of ['alice', 'bob']) { await service.request('save', id, [{ ...DEFAULT_AGENT_SETTINGS, goal: '评审', sources: ['https://example.com/'] }]); await service.request('run', id) }
  await vi.waitFor(() => expect(calls).toHaveLength(2))
  expect(calls.find(call => call.id === 'alice')!.prompt).toContain('alice 的独立技能正文')
  expect(calls.find(call => call.id === 'alice')!.prompt).not.toContain('bob 的独立技能正文')
  const run = service.store.overview('alice').runs[0]
  expect(JSON.parse(service.store.getRun(run.id)!.input).skills.instruction).toBe('alice 的独立技能正文')
  await service.sync(identities.map(identity => ({ ...identity, skills: { entries: [], instruction: '' } })))
  expect(calls[0].signal.aborted).toBe(false)
  latest = { entries: [], instruction: '最新技能配置' }
  const finished = JSON.stringify({ title: '判断', body: '资料 [1] 待核实', nextStep: '继续核实', memories: [], question: '', progress: { judgement: '需求尚待验证', openQuestions: '是否愿意付费', nextStep: '继续核对', reason: '根据资料 [1]', status: 'needs_evidence' } })
  calls.find(call => call.id === 'alice')!.resolve(finished)
  await vi.waitFor(() => expect(service.store.getRun(run.id)?.status).toBe('completed'))
  await service.request('run', 'alice')
  await vi.waitFor(() => expect(calls.filter(call => call.id === 'alice')).toHaveLength(2))
  expect(calls.filter(call => call.id === 'alice')[1].prompt).toContain('最新技能配置')
  expect(JSON.parse(service.store.getRun(run.id)!.input).skills.instruction).toBe('alice 的独立技能正文')
})

it('recovers an interrupted round with its saved skills after a worker restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'chouyu-skill-restart-'))
  const prompts: string[] = []
  let instruction = '原轮技能标记'
  const create = () => new AgentService(root, () => {}, () => (prompt, signal) => new Promise((_resolve, reject) => {
    prompts.push(prompt); signal.addEventListener('abort', () => reject(new Error('closed')), { once: true })
  }), async () => evidenceFromText('https://example.com/', '资料事实。'.repeat(40)), undefined, () => ({ entries: [], instruction }))
  let service = create()
  cleanups.push(async () => { await service.close(); rmSync(root, { recursive: true, force: true }) })
  const identity: AgentIdentity = { id: 'alice', soul: 'alice', conversation: '', config: { provider: 'openai', baseUrl: 'https://example.com', apiKey: 'test', model: 'test', thinkingDisabledModels: [] } }
  await service.sync([identity])
  await service.request('save', 'alice', [{ ...DEFAULT_AGENT_SETTINGS, goal: '评审', sources: ['https://example.com/'] }])
  await service.request('run', 'alice')
  await vi.waitFor(() => expect(prompts).toHaveLength(1))
  const runId = service.store.overview('alice').runs[0].id
  await service.close()
  instruction = '重启后新技能标记'
  service = create(); await service.sync([identity])
  await vi.waitFor(() => expect(prompts).toHaveLength(2))
  expect(prompts[1]).toContain('原轮技能标记')
  expect(prompts[1]).not.toContain('重启后新技能标记')
  expect(JSON.parse(service.store.getRun(runId)!.input).skills.instruction).toBe('原轮技能标记')
})
