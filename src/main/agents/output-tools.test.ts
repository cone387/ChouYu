import { expect, it, vi } from 'vitest'
import { createOutputTools } from './output-tools'
import { routeContactChange } from './chat-changes'
import type { ToolExecutionContext } from '../tools/registry'

it('shows saved expression rules to interpretation and refuses a concurrent overwrite', async () => {
  const execute = vi.fn(), before = { scope: { kind: 'contact' as const }, revision: 2, preference: { instruction: '保留引用来源' } }
  const model = vi.fn(async (_prompt: string, content: string) => {
    expect(JSON.parse(content).outputPreferences).toEqual([before])
    return JSON.stringify({ kind: 'output', scope: 'contact', patch: { instruction: '保留引用来源，先结论后依据' } })
  })
  await expect(routeContactChange([{ role: 'user', content: '以后先结论后依据' }], {
    model, execute, outputPreferences: async () => [before], read: async method => method === 'get' ? { topics: [], runs: [], settings: {} } : [{ ...before, revision: 3 }]
  })).rejects.toThrow('解析期间')
  expect(execute).not.toHaveBeenCalled()
})

function fixture() {
  let owner = 'alice', revision = 2
  const request = vi.fn(async (method: string, _owner: string, args: any[] = []) => {
    if (method === 'outputPreferences') return [{ scope: { kind: 'contact' }, revision, preference: {} }, ...(args[0] ? [{ scope: { kind: args[1] ? 'delivery' : 'task', topicId: args[0], ...(args[1] ? { version: args[1] } : {}) }, revision, preference: {} }] : [])]
    if (method === 'setOutputPreference') { if (args[1] !== revision) throw new Error('变化'); return { scope: args[0], revision: ++revision, preference: args[2] } }
    throw new Error(method)
  })
  const tools = createOutputTools({ owner: () => owner, request })
  const prepare = (args: any) => tools.find(t => t.name === 'set_contact_output_preference')!.prepareAsync!(args, { sessionId: 'chat' } as ToolExecutionContext)
  return { request, prepare, owner: (id: string) => { owner = id }, advance: () => { revision++ } }
}
it('previews an exact scope and persists only the requested reading preference', async () => {
  const f = fixture(), prepared = await f.prepare({ scope: 'delivery', topicId: 't', deliveryVersion: 3, revision: 2, kind: 'review', reason: '这次先给结论' })
  expect(prepared.preview).toContain('版本 3')
  expect(f.request.mock.calls.some(c => c[0] === 'setOutputPreference')).toBe(false)
  expect(JSON.parse((await prepared.execute()).content)).toMatchObject({ saved: true, revision: 3 })
  expect(f.request).toHaveBeenLastCalledWith('setOutputPreference', 'alice', [{ kind: 'delivery', topicId: 't', version: 3 }, 2, { kind: 'review' }, '这次先给结论'])
  await expect(prepared.execute()).rejects.toThrow('执行')
})
it('rejects missing scopes, stale revisions, foreign sessions and malformed metadata', async () => {
  const f = fixture(), args = { scope: 'contact', revision: 2, density: 'compact', reason: '以后紧凑点' }
  await expect(f.prepare({ ...args, scope: 'delivery' })).rejects.toThrow()
  await expect(f.prepare({ ...args, kind: 'html' })).rejects.toThrow()
  const prepared = await f.prepare(args); f.owner('bob')
  await expect(prepared.execute()).rejects.toThrow('归属')
  f.owner('alice'); const stale = await f.prepare(args); f.advance()
  await expect(stale.execute()).rejects.toThrow('变化')
})
it('routes a one-version preference with real version and revision and rejects invented receipts', async () => {
  const f = fixture(), execute = vi.fn(async call => (await (await f.prepare(JSON.parse(call.arguments))).execute()).content)
  const read = vi.fn(async (method, args) => method === 'get' ? { topics: [{ id: 't', title: '评审' }], runs: [] } : method === 'delivery' ? { version: 3 } : f.request(method, 'alice', args))
  const deps = { read, execute, model: async () => JSON.stringify({ kind: 'output', scope: 'delivery', topicId: 't', patch: { kind: 'review' } }) }
  expect(await routeContactChange([{ role: 'user', content: '评审这次先给结论' }], deps)).toContain('已保存')
  expect(JSON.parse(execute.mock.calls[0][0].arguments)).toMatchObject({ scope: 'delivery', deliveryVersion: 3, revision: 2 })
  execute.mockImplementation(async () => JSON.stringify({ saved: true, revision: 3, message: '已保存' }))
  await expect(routeContactChange([{ role: 'user', content: '评审这次紧凑点' }], deps)).rejects.toThrow('回执')
})
it('submits one-version expression changes as real version-bound revisions, not inert preferences', async () => {
  const execute = vi.fn(async call => {
    expect(call.name).toBe('submit_contact_delivery_feedback')
    expect(JSON.parse(call.arguments)).toMatchObject({ topicId: 't', revision: 4, deliveryVersion: 3, action: 'revise', reason: '这次先讲结论' })
    return JSON.stringify({ saved: true, topicId: 't', version: 3, action: 'revise', workCompleted: false, message: '已提交修订' })
  })
  expect(await routeContactChange([{ role: 'user', content: '这次先讲结论' }], {
    model: async () => JSON.stringify({ kind: 'output', scope: 'delivery', topicId: 't', patch: { instruction: '先讲结论' } }), execute,
    read: async method => method === 'get' ? { topics: [{ id: 't', title: '评审', revision: 4 }], runs: [] } : { version: 3 }
  })).toBe('已提交修订')
  expect(execute).toHaveBeenCalledTimes(1)
})
