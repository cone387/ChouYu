import { expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { streamNativeChat } from '../harness/native/runner'
import { resolveCharacterConfig } from '../../shared/characters'
import { DEFAULT_APP_CONFIG } from '../../shared/config'
import { ContactTaskStore } from '../task-center/contact-store'
import { buildContactContext } from './context'
import { citationContext } from './citations'
import { createMaterialTools } from './material-tools'
import { contactCommunicationInstructions } from '../../shared/contact-communication'
import type { ToolExecutionContext } from '../tools/registry'

// Paid opt-in. Only provider configuration is inherited; all content is synthetic.
it.skipIf(!process.env.CHOUYU_EXPERIENCE_ACCEPTANCE)('real model applies corrected scoped memory, reads material and reviews the pinned historical version', async () => {
  const data = JSON.parse(process.env.CHOUYU_ACCEPTANCE_CONFIG!), resolved = resolveCharacterConfig(data.characters[0], data.config)
  if (!resolved.ok) throw new Error('联系人模型配置不可用')
  const store = new ContactTaskStore(':memory:'), outputs: unknown[] = [], calls: string[] = []
  const config = { ...DEFAULT_APP_CONFIG, ...data.config, ...resolved.config }
  try {
    store.ensure('writer'); store.ensure('reviewer')
    const topic = store.topics.create('writer', { title: '灯塔故事', goal: '合成写作验收', constraints: '' }, 'user')
    const initial = { content: '故事主角叫林旧。', kind: 'project' as const, scope: { kind: 'task' as const, topicId: topic.id }, source: { kind: 'user' as const, at: Date.now() } }
    const memory = store.memoryLibrary.create('writer', initial)
    store.memoryLibrary.update('writer', memory.id, 1, { ...initial, content: '已纠正：故事主角叫沈青，故事地点是雾港。' })
    store.memoryLibrary.create('reviewer', { ...initial, scope: { kind: 'contact' }, content: '另一联系人的私人暗号是松石九号。' })
    const material = store.materials.save('writer', { name: '灯塔设定', content: '雾港灯塔每逢周四亮起蓝色灯光。灯塔守望者是一位退休钟表匠。', source: { kind: 'text', label: '合成验收设定' }, scope: { kind: 'task', topicId: topic.id } })
    const context = buildContactContext(store, { characterId: 'writer', topicId: topic.id, query: '主角 灯塔 故事' })
    expect(context.text).not.toContain('林旧'); expect(context.text).not.toContain('松石九号')
    const tools = createMaterialTools({ owner: () => 'writer', dispatchUnknown: async (method, owner, args) => {
      if (method === 'materialList') return store.materials.list({ ...(args[0] as object), characterId: owner, topicId: topic.id, query: '' })
      if (method === 'readMaterial') return store.materials.read({ characterId: owner, topicId: topic.id, query: '' }, args[1] as { id: string; version: number }, args[2] as number)
      throw new Error('Unexpected acceptance method')
    } })
    let prose = '', usage: unknown
    await streamNativeChat([{ role: 'user', content: `请读取资料“灯塔设定”，写一段不超过150字的正文，使用我纠正后的主角姓名、地点、灯光颜色和亮灯日期，正文后明确注明资料名和版本。任务 ID：${topic.id}。` }], `${resolved.config.soulMd}\n${contactCommunicationInstructions('conversation')}\n${context.text}`, config, chunk => { prose += chunk }, AbortSignal.timeout(100000), {
      definitions: tools, execute: async call => { calls.push(call.name); if (calls.length > 5) throw Error('Tool limit'); const tool = tools.find(tool => tool.name === call.name); if (!tool) throw Error('Unexpected tool'); return (await tool.execute(JSON.parse(call.arguments), {} as ToolExecutionContext)).content }
    }, { timeoutMs: 100000, maxOutputTokens: 1600, onMetadata: value => { usage = value } })
    outputs.push({ kind: 'material-and-memory', prose, usage, suppliedMemories: context.memories, material: { id: material.id, version: material.version }, calls })
    expect(calls).toContain('read_contact_material'); expect(prose).toMatch(/沈青/); expect(prose).toMatch(/雾港/); expect(prose).toMatch(/周四|星期四/); expect(prose).toMatch(/蓝/); expect(prose).toMatch(/灯塔设定/); expect(prose).not.toMatch(/林旧|松石九号/)
    const publish = (body: string) => { const id = store.createRun('writer', '', Date.now(), topic.id); store.finish(id, { runId: id, title: '正文', body, nextStep: 'Continue', evidence: [], createdAt: Date.now() }, [], { status: 'researching', judgement: 'Saved', reason: 'Saved', nextStep: 'Continue', openQuestions: '' }, { completionCriteria: 'Write', stages: [{ id: 'write', title: '写作', status: 'active' }], summary: 'Saved', section: { id: 'text', title: '正文', body } }) }
    publish(prose); publish('最新版：主角换成陆白，在晴港看周日亮起的红灯。')
    const pinned = citationContext('writer', [{ ref: { characterId: 'writer', topicId: topic.id, version: 1, sectionId: 'text' } }], store.portfolio)
    let review = ''
    await streamNativeChat([{ role: 'user', content: '请只评审附带的第1版，先明确版本与主角，再给一个具体修改建议及原文依据。已知第2版把人物改为陆白，但这次不评审它。不要声称已修改原文。' }], `你是独立稿件评审者。${contactCommunicationInstructions('conversation')}${pinned}`, config, chunk => { review += chunk }, AbortSignal.timeout(90000), undefined, { timeoutMs: 90000, maxOutputTokens: 1400, onMetadata: value => { usage = value } })
    outputs.push({ kind: 'pinned-review', review, usage, sourceVersion: 1, latestVersion: 2 })
    expect(review).toMatch(/沈青/); expect(review).toMatch(/第\s*1\s*版|第一版|版本\s*1/); expect(store.deliveries.get(topic.id)?.version).toBe(2)
  } finally {
    mkdirSync('artifacts', { recursive: true }); writeFileSync('artifacts/contact-experience-model.json', JSON.stringify({ model: config.model, outputs }, null, 2)); store.close()
  }
}, 230000)
