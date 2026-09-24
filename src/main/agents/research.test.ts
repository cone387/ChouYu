import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentStore } from './store'
import { AgentRuntime } from './runtime'
import { parseResearchPlan, researchUrl, searchBrave } from './research'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import type { AgentResearchPlan } from '../../shared/agents'
import { evidenceFromText } from './sources'

const dirs: string[] = [], closers: (() => void)[] = []
const seed = 'https://example.com/seed', found = 'https://example.org/pricing'
const plan: AgentResearchPlan = { action: 'search', reason: '核对免费替代品与付费差异', query: '团队工具 免费 替代品 定价', urls: [], checkAfterMinutes: 180 }
const draft = { title: '付费假设待验证', body: '原文 [1] 提到免费版本。', nextStep: '核对团队功能', memories: [], question: '', progress: { judgement: '存在免费替代品，收益未验证', reason: '资料 [1] 改变初始判断', openQuestions: '团队会付费吗', nextStep: '核对团队功能', status: 'needs_evidence' } }
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-research-')); dirs.push(dir)
  const store = new AgentStore(join(dir, 'agents.db'))
  store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '寻找团队需求', sources: [seed], searchEnabled: true, dailyCalls: 24, dailySearches: 2 })
  const reader = vi.fn(async (url: string) => evidenceFromText(url, '公开定价说明：个人免费，团队版需要核对。'.repeat(10)))
  const searcher = vi.fn(async () => [{ url: found, title: '定价' }])
  const runtime = new AgentRuntime(store, join(dir, 'checkpoints.db'), reader, searcher)
  closers.push(() => store.close(), () => runtime.close())
  const run = async (p = plan, d = draft) => {
    const id = store.createRun('alice', 'PRIVATE_CHAT_NOT_FOR_SEARCH')
    const model = vi.fn(async (prompt: string) => {
      expect(prompt).not.toContain('SEARCH_SECRET')
      if (prompt.startsWith('为联系人')) { expect(prompt).not.toContain('PRIVATE_CHAT_NOT_FOR_SEARCH'); return JSON.stringify(p) }
      return JSON.stringify(d)
    })
    await runtime.execute(id, '', model, new AbortController().signal, () => {}, 'SEARCH_SECRET')
    return { id, model, detail: store.detail('alice', id) }
  }
  return { dir, store, reader, searcher, runtime, run }
}
afterEach(() => { vi.unstubAllGlobals(); for (const close of closers.splice(0).reverse()) close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('autonomous evidence research', () => {
  it('plans, searches, reads original evidence and keeps credentials out of persisted state', async () => {
    const { run, store, dir, searcher } = fixture(), result = await run()
    expect(result.detail.run.status).toBe('completed')
    expect(result.model).toHaveBeenCalledTimes(2)
    expect(result.detail.research?.searches[0].results[0].url).toBe(found)
    expect(result.detail.report?.evidence[0].url).toBe(found)
    expect(result.detail.research?.reads[0].status).toBe('read')
    expect(store.callCount('alice')).toBe(2); expect(store.searchCount('alice')).toBe(1)
    expect(searcher).toHaveBeenCalledWith(plan.query, 'SEARCH_SECRET', expect.any(AbortSignal))
    expect(JSON.stringify(store.detail('alice', result.id))).not.toContain('SEARCH_SECRET')
    for (const file of ['agents.db', 'checkpoints.db']) expect(readFileSync(join(dir, file)).includes(Buffer.from('SEARCH_SECRET'))).toBe(false)
    expect(() => store.detail('bob', result.id)).toThrow()
  })
  it('skips repeated analysis, grows the delay and respects changed topic constraints', async () => {
    const { run, store } = fixture()
    const first = await run(), topic = store.overview('alice').topics[0]
    store.notices.ack('alice', store.notices.pending('alice')[0].id)
    const second = await run({ ...plan, action: 'read', query: '', urls: [found] })
    expect(second.model).toHaveBeenCalledTimes(1)
    expect(second.detail.report).toBeNull(); expect(second.detail.research?.unchanged).toBe(true)
    expect(second.detail.research!.nextCheckAt! - second.detail.run.updatedAt).toBeGreaterThanOrEqual(359 * 60000)
    expect(store.topics.get('alice', topic.id).revision).toBe(topic.revision)
    expect(store.notices.pending('alice', Date.now() + 3600000)).toEqual([])
    const third = await run({ ...plan, action: 'read', query: '', urls: [found] })
    expect(third.detail.research!.nextCheckAt! - third.detail.run.updatedAt).toBeGreaterThanOrEqual(719 * 60000)
    store.changeTopic('alice', topic.id, topic.revision, { input: { title: topic.title, goal: topic.goal, constraints: '只分析企业用户' }, reason: '用户缩小范围' })
    const changed = await run({ ...plan, action: 'read', query: '', urls: [found] })
    expect(changed.model).toHaveBeenCalledTimes(2)
    expect(store.overview('alice').reports).toHaveLength(2)
    expect(first.detail.report).not.toBeNull()
  })
  it('waits without fetching or inventing a report and cannot schedule earlier than the user interval', async () => {
    const { run, reader, searcher, store } = fixture()
    const result = await run({ ...plan, action: 'wait', query: '', checkAfterMinutes: 15 })
    expect(result.detail.run.status).toBe('completed'); expect(result.detail.report).toBeNull()
    expect(result.model).toHaveBeenCalledTimes(1); expect(reader).not.toHaveBeenCalled(); expect(searcher).not.toHaveBeenCalled()
    expect(store.overview('alice').nextAt).toBeGreaterThan(Date.now() + 179 * 60000)
  })
  it('falls back to permitted seeds on search failure without treating snippets as evidence', async () => {
    const { run, searcher } = fixture()
    searcher.mockRejectedValue(new Error('SEARCH_SECRET upstream error'))
    const result = await run()
    expect(result.detail.research?.searches[0].error).toContain('搜索不可用')
    expect(result.detail.report?.evidence[0].url).toBe(seed)
    expect(JSON.stringify(result.detail)).not.toContain('SEARCH_SECRET')
  })
  it('persists failed attempts in the search quota and does not call a depleted provider', async () => {
    const { run, searcher, store } = fixture()
    searcher.mockRejectedValue(new Error('unavailable'))
    await run(); await run(); const last = await run()
    expect(searcher).toHaveBeenCalledTimes(2); expect(store.searchCount('alice')).toBe(2)
    expect(last.detail.research?.searches[0].error).toBeTruthy()
  })
  it('resumes a durable question without repeating planning, search, or analysis', async () => {
    const { run, store, runtime, dir, reader, searcher } = fixture()
    const waiting = await run(plan, { ...draft, question: '你是否熟悉团队场景？' })
    expect(waiting.detail.run.status).toBe('waiting')
    runtime.close(); store.close(); closers.splice(0)
    const recovered = new AgentStore(join(dir, 'agents.db')), graph = new AgentRuntime(recovered, join(dir, 'checkpoints.db'), reader, searcher)
    closers.push(() => recovered.close(), () => graph.close())
    recovered.answer('alice', waiting.id, '熟悉，只研究团队')
    const model = vi.fn(async () => '')
    await graph.execute(waiting.id, '', model, new AbortController().signal, () => {}, 'SEARCH_SECRET')
    expect(model).not.toHaveBeenCalled(); expect(searcher).toHaveBeenCalledTimes(1)
    expect(recovered.detail('alice', waiting.id).report?.body).toContain('只研究团队')
  })
  it('does not create evidence or progress if all candidate pages fail', async () => {
    const { run, reader, store } = fixture(); reader.mockRejectedValue(new Error('blocked'))
    const result = await run()
    expect(result.detail.run.status).toBe('failed'); expect(result.detail.report).toBeNull()
    expect(result.detail.research?.reads[0].status).toBe('failed')
    expect(result.model).toHaveBeenCalledTimes(1); expect(store.overview('alice').topics[0].revision).toBe(1)
  })
  it('reuses the persisted search result after cancellation between search and page retrieval', async () => {
    const { store, runtime, reader, searcher, dir } = fixture()
    const controller = new AbortController(), id = store.createRun('alice', '')
    reader.mockImplementationOnce(async () => { controller.abort(new Error('worker stopped')); throw new Error('worker stopped') })
    const planner = vi.fn(async () => JSON.stringify(plan))
    await expect(runtime.execute(id, '', planner, controller.signal, () => {}, 'SEARCH_SECRET')).rejects.toThrow()
    expect(searcher).toHaveBeenCalledTimes(1)
    runtime.close(); store.close(); closers.splice(0)
    const recovered = new AgentStore(join(dir, 'agents.db')), graph = new AgentRuntime(recovered, join(dir, 'checkpoints.db'), reader, searcher)
    closers.push(() => recovered.close(), () => graph.close())
    recovered.recover()
    const model = vi.fn(async () => JSON.stringify(draft))
    await graph.execute(id, '', model, new AbortController().signal, () => {}, 'SEARCH_SECRET')
    expect(recovered.detail('alice', id).run.status).toBe('completed')
    expect(model).toHaveBeenCalledTimes(1); expect(searcher).toHaveBeenCalledTimes(1)
    expect(recovered.searchCount('alice')).toBe(1)
  })
  it('reserves model budget before creating a research round', () => {
    const { store } = fixture()
    store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '预算验证', sources: [seed], searchEnabled: true, dailyCalls: 2 })
    const id = store.createRun('alice', '')
    store.charge(id); store.cancel('alice', '测试停止')
    expect(() => store.createRun('alice', '')).toThrow('预留两次')
    expect(store.overview('alice').runs).toHaveLength(1)
  })
})

describe('search provider boundary', () => {
  it('pins the API endpoint, disables redirects, deduplicates and filters unsafe result URL schemes', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ web: { results: [{ url: found, title: '定价' }, { url: found }, { url: 'http://example.com' }, { url: 'https://example.com/?api_key=secret' }, { url: seed }] } })))
    vi.stubGlobal('fetch', fetcher)
    const result = await searchBrave('公开疑问', 'secret', new AbortController().signal)
    expect(result.map(r => r.url)).toEqual([found, seed])
    const [url, options] = fetcher.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.origin).toBe('https://api.search.brave.com'); expect(options.redirect).toBe('error')
    expect(url.href).not.toContain('secret')
    expect(options.headers).toEqual({ 'X-Subscription-Token': 'secret', Accept: 'application/json' })
  })
  it('rejects missing credentials, oversized response and HTTP failure', async () => {
    const fetcher = vi.fn(async () => new Response('x'.repeat(524289)))
    vi.stubGlobal('fetch', fetcher)
    await expect(searchBrave('q', '', new AbortController().signal)).rejects.toThrow('配置')
    expect(fetcher).not.toHaveBeenCalled()
    await expect(searchBrave('q', 'key', new AbortController().signal)).rejects.toThrow('上限')
    fetcher.mockResolvedValue(new Response('provider secret details', { status: 429 }))
    await expect(searchBrave('q', 'key', new AbortController().signal)).rejects.toThrow('HTTP 429')
  })
  it('rejects unbounded plans and new arbitrary read URLs', () => {
    for (const value of [{ ...plan, action: 'read', urls: [found] }, { ...plan, query: '' }, { ...plan, checkAfterMinutes: 0 }, { ...plan, query: 'api_key=supersecret123456' }]) expect(() => parseResearchPlan(JSON.stringify(value), [seed], 180)).toThrow()
    expect(researchUrl('https://user:pass@example.com')).toBeNull()
    expect(researchUrl('https://example.com:444')).toBeNull()
  })
})
