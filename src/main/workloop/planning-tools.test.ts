import { expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { WorkLoopHost } from '../agent-space/workloop-host'
import { createBackgroundHarnesses } from '../harness/background'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'

it.each(['native', 'dsh'] as const)('%s plans before executing tools and reviews actual shared prose', async engine => {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-planning-tools-'))
  const requests: { stage: string; tools: string[] }[] = []
  let host: WorkLoopHost | undefined
  const progress = { status: 'researching' as const, judgement: '已保存本轮成果', openQuestions: '', nextStep: '继续下一期', reason: '真实正文' }
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    const prompt = body.messages.filter((item: { role: string }) => item.role === 'user').at(-1).content as string
    const tools = (body.tools ?? []).map((tool: { function: { name: string } }) => tool.function.name)
    const stage = prompt.startsWith('你是联系人，刚收到') ? 'brief' : prompt.startsWith('为联系人的同一个事项') ? 'plan' : 'write'
    requests.push({ stage, tools })
    let output: unknown
    if (stage === 'brief') {
      // Reproduces the live model's wrong upload requirement when execution tools leak into intake.
      output = { title: '独立评审', nextStep: '读取共享成果再评审', question: '', resourceBudget: { modelCalls: 20, reason: '持续评审' },
        plan: { completionCriteria: '持续独立评审', stages: [{ id: 'review', title: '读取与评审', status: 'pending' }],
          ...(tools.length ? { inputs: [{ id: 'author_text', label: '作者最新正式正文', value: '', required: true }] } : {}) } }
    } else if (stage === 'plan') {
      const topic = host!.store.overview('reviewer').focusTopicId!
      const source = host!.runtime.contactSources.discover('reviewer', topic, '').items[0]
      output = { action: 'read_contacts', reason: '实际读取作者正文', contactRefs: [source.ref], query: '', urls: [], checkAfterMinutes: 15 }
    } else {
      output = { title: '评审结论', body: '基于真实正文 [1]', nextStep: '继续下一期', memories: [], question: '',
        progress: { ...progress, judgement: '已读取作者全文（12字）[1]。线索明确。' },
        delivery: { completionCriteria: '持续独立评审', summary: '已评审首节', stages: [{ id: 'review', title: '读取与评审', status: 'active' }],
          section: { id: 'review1', title: '结论', body: prompt.includes('真实来源正文：灯塔亮起蓝光') ? '灯塔蓝光的线索明确，建议补充人物动机 [1]。' : '未读到正文' } } }
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const send = (value: object) => response.write('data: ' + JSON.stringify(value) + '\n\n')
    send({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: JSON.stringify(output) }, finish_reason: null }] })
    send({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
    send({ id: 'fixture', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } })
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const config = { provider: 'openai' as const, baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'fixture', model: 'fixture', thinkingDisabledModels: [] }
  try {
    host = new WorkLoopHost(join(dir, 'contacts'), () => {}, undefined, undefined, undefined, undefined, undefined,
      { harnesses: createBackgroundHarnesses({ home: join(dir, 'dsh'), node: process.execPath, helper: resolve('runtime/dsh/helper.mjs') }) })
    await host.sync(['writer', 'reviewer'].map(id => ({ id, name: id, soul: id, conversation: '', config, skillToolsEnabled: true, backgroundHarnessEngine: engine })))
    host.store.save('writer', { ...DEFAULT_AGENT_SETTINGS, enabled: false, goal: '灯塔故事', shareDeliveries: true })
    const sourceRun = host.store.createRun('writer', '')
    host.store.finish(sourceRun, { runId: sourceRun, title: '灯塔故事', body: '已保存', nextStep: '继续', evidence: [], createdAt: Date.now() }, [], progress,
      { completionCriteria: '持续写作', summary: '首节', stages: [{ id: 'write', title: '写作', status: 'active' }], section: { id: 'chapter1', title: '雾港', body: '真实来源正文：灯塔亮起蓝光' } })
    await host.request('savePreferences', 'reviewer', [{ ...DEFAULT_AGENT_SETTINGS, goal: '独立评审', enabled: false, dailyCalls: 40, dailyTokenLimit: 100000, readContactDeliveries: true, searchEnabled: false, paceWriting: true, intervalMinutes: 15 }])
    await host.request('assignTopic', 'reviewer', ['持续独立评审作者共享的灯塔故事，不需要用户上传正文'])
    await vi.waitFor(() => expect(host!.store.overview('reviewer').runs.some(run => ['completed', 'waiting', 'failed'].includes(run.status))).toBe(true), { timeout: 30000 })
    const data = host.store.overview('reviewer')
    expect(data.runs[0].status, JSON.stringify(data.runs)).toBe('completed')
    expect(data.reports[0].evidence[0].text).toBe('真实来源正文：灯塔亮起蓝光')
    expect(host.store.deliveries.get(data.focusTopicId!)?.sections[0].body).toContain('灯塔蓝光的线索明确')
    expect(requests.map(item => item.stage)).toEqual(['brief', 'plan', 'write'])
    expect(requests[0].tools).toEqual([])
    expect(requests[1].tools.toSorted()).toEqual(['read_task_context', 'search_task_context'])
    expect(requests[2].tools).toContain('read_contact_material')
  } finally {
    await host?.close()
    await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })
    rmSync(dir, { recursive: true, force: true })
  }
}, 60000)
