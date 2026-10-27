import { expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { WorkLoopHost } from '../agent-space/workloop-host'
import { createBackgroundHarnesses } from '../harness/background'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'

const OLD = 'EARLY_BODY_COBALT_739', MEMORY = 'TASK_MEMORY_LARCH_286', FEEDBACK = 'ACCEPTED_COMMENT_EMBER_451', RESEARCH = 'RESEARCH_HYPOTHESIS_ORCHID_628'
it.each(['native', 'dsh'] as const)('%s plans and delivers using actual task-context tool results with script tools disabled', async engine => {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-task-context-'))
  const calls: { prompt: string; tools: string[]; results: any[] }[] = []
  const refs: { kind: string; id: string; version: number }[] = []
  const progress = { status: 'researching' as const, judgement: '已保存本轮正文', openQuestions: '', nextStep: '继续推进原任务', reason: '本轮有新增内容' }
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    const prompt = body.messages.filter((item: { role: string }) => item.role === 'user').at(-1).content as string
    const tools = (body.tools ?? []).map((tool: { function: { name: string } }) => tool.function.name)
    const results: any[] = body.messages.filter((item: { role: string }) => item.role === 'tool').map((item: { content: string }) => { try { return JSON.parse(item.content) } catch { return item.content } })
    calls.push({ prompt, tools, results })
    const plan = prompt.startsWith('为联系人的同一个事项')
    let toolCalls: { name: string; args: unknown }[] = []
    if (tools.includes('search_task_context')) {
      if (plan && !results.length) toolCalls = [{ kind: 'deliveries', query: OLD }, { kind: 'memories', query: RESEARCH }, { kind: 'feedback', query: FEEDBACK }].map(args => ({ name: 'search_task_context', args }))
      else if (plan && results.length === 3 && results.every(result => result.items?.length)) {
        refs.splice(0, refs.length, ...results.map(result => result.items[0].ref))
        toolCalls = refs.map(ref => ({ name: 'read_task_context', args: ref }))
      } else if (!plan && !results.length && refs.length) toolCalls = refs.map(ref => ({ name: 'read_task_context', args: ref }))
    }
    const actual = results.filter(result => typeof result.text === 'string' && 'total' in result)
    const allRead = [OLD, RESEARCH, FEEDBACK].every(text => actual.some(result => result.text === text))
    const output = plan
      ? { action: 'write', reason: allRead ? '依据真实回查结果继续推进' : '缺少回查', query: '', urls: [], checkAfterMinutes: 15, evaluation: false }
      : { title: '本轮想法', body: '已补充本轮正文', nextStep: '继续推进原任务', memories: [], question: '', progress,
        delivery: { completionCriteria: '持续提出想法', summary: '继续推进', stages: [{ id: 'work', title: '持续工作', status: 'active' }],
          section: { id: 'entry6', title: '本轮想法', body: allRead ? `沿用旧成果 ${OLD}，按反馈 ${FEEDBACK} 推进；研究 ${RESEARCH} 仍待验证。` : '未读取历史' } } }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const send = (value: object) => response.write('data: ' + JSON.stringify(value) + '\n\n')
    const delta = toolCalls.length ? { role: 'assistant', tool_calls: toolCalls.map((call, index) => ({ index, id: `call_${calls.length}_${index}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } })) } : { role: 'assistant', content: JSON.stringify(output) }
    send({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta, finish_reason: null }] })
    send({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: toolCalls.length ? 'tool_calls' : 'stop' }] })
    send({ id: 'fixture', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } })
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const config = { provider: 'openai' as const, baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, apiKey: 'fixture', model: 'fixture', thinkingDisabledModels: [] }
  const identity = { id: 'alice', name: 'Alice', soul: '独立联系人', conversation: '', config, skillToolsEnabled: false, backgroundHarnessEngine: engine }
  const open = () => new WorkLoopHost(join(dir, 'contacts'), () => {}, undefined, undefined, undefined, undefined, undefined,
    { harnesses: createBackgroundHarnesses({ home: join(dir, 'dsh'), node: process.execPath, helper: resolve('runtime/dsh/helper.mjs') }) })
  let host = open()
  try {
    await host.sync([identity])
    host.store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '持续提出有价值的想法', enabled: false, dailyCalls: 100, dailyTokenLimit: 200000, searchEnabled: false, intervalMinutes: 15 })
    const topicId = host.store.overview('alice').focusTopicId!
    for (let i = 1; i <= 5; i++) {
      const runId = host.store.createRun('alice', '', Date.now(), topicId)
      host.store.finish(runId, { runId, title: `记录${i}`, body: i === 1 ? OLD : `第${i}轮摘要`, nextStep: '继续', evidence: [], createdAt: Date.now() }, i === 1 ? [RESEARCH] : [], progress,
        { completionCriteria: '持续提出想法', summary: `已有${i}条正文`, stages: [{ id: 'work', title: '持续工作', status: 'active' }], section: { id: `entry${i}`, title: `想法${i}`, body: i === 1 ? OLD : `第${i}条独立正文` } })
    }
    host.store.memoryLibrary.create('alice', { content: MEMORY, kind: 'preference', scope: { kind: 'task', topicId }, source: { kind: 'user', at: Date.now() } })
    host.store.feedbackLedger.submit('alice', { requestId: 'context-feedback', topicId, revision: host.store.topics.get('alice', topicId).revision, version: 5, action: 'accept', reason: FEEDBACK })
    await host.close(); host = open(); await host.sync([identity])
    await host.request('run', 'alice', [topicId])
    await vi.waitFor(() => expect(host.store.overview('alice').runs[0].status).toBe('completed'), { timeout: 30000 })
    const planCalls = calls.filter(call => call.prompt.startsWith('为联系人的同一个事项'))
    const writeCalls = calls.filter(call => !call.prompt.startsWith('为联系人的同一个事项'))
    expect(planCalls[0].prompt).toContain(MEMORY)
    expect(planCalls[0].prompt).toContain(FEEDBACK)
    expect(planCalls[0].prompt).not.toContain(OLD)
    expect(planCalls[0].prompt).not.toContain(RESEARCH)
    expect(planCalls).toHaveLength(3)
    expect(writeCalls).toHaveLength(2)
    expect(writeCalls[0].prompt).toContain('entry1')
    expect(writeCalls[0].prompt).toContain(FEEDBACK)
    for (const call of calls) expect(call.tools.toSorted()).toEqual(['read_task_context', 'search_task_context'])
    expect(planCalls.at(-1)!.results.find(result => result.text === RESEARCH)).toMatchObject({ status: 'candidate', source: { kind: 'research' } })
    expect(host.store.deliveries.get(topicId)!.sections.at(-1)!.body).toContain(`沿用旧成果 ${OLD}`)
    expect(host.store.memoryLibrary.list('alice').find(memory => memory.content === RESEARCH)?.status).toBe('candidate')
    const latest = host.store.getRun(host.store.overview('alice').runs[0].id)!
    expect(JSON.parse(latest.input).recallReferences).toHaveLength(3)
    expect(host.store.research(latest.id)?.reads).toEqual([])
  } finally {
    await host.close()
    await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })
    rmSync(dir, { recursive: true, force: true })
  }
}, 60000)
