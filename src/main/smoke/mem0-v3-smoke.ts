import { createServer } from 'http'
import { app } from 'electron'
import { join } from 'path'
import { getConfig, saveConfig } from '../database'
import { Mem0MemoryProvider } from '../memory/mem0-provider'

export async function runMem0V3Smoke(): Promise<void> {
  const original = getConfig()
  const records = [
    { id: 'seed-a', memory: 'V3 第一条合成记忆', user_id: 'alice', metadata: {} as Record<string, unknown> },
    { id: 'seed-b', memory: 'V3 第二条合成记忆', user_id: 'alice', metadata: {} as Record<string, unknown> },
    { id: 'foreign', memory: '其他用户', user_id: 'bob', metadata: {} as Record<string, unknown> }
  ]
  const eventId = '11111111-2222-3333-4444-555555555555'
  let eventRecord: typeof records[number] | undefined, eventReads = 0, adds = 0, lists = 0, authFailure = false
  const seen: string[] = []
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', data => { raw += data })
    req.on('end', () => {
      const send = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)) }
      try {
        if (authFailure || req.headers.authorization !== 'Token v3-fixture') { send(401, {}); return }
        const url = new URL(req.url!, 'http://localhost'), body = raw ? JSON.parse(raw) : {}
        seen.push(`${req.method} ${url.pathname}`)
        if (req.method === 'POST' && ['/v3/memories/', '/v3/memories/search/'].includes(url.pathname)) {
          if (body.user_id || body.filters?.user_id !== 'alice' || url.searchParams.has('user_id')) { send(400, {}); return }
          const selected = records.filter(row => row.user_id === body.filters.user_id)
          if (url.pathname.endsWith('/search/')) { send(200, { results: selected.filter(row => row.memory.includes(body.query)).slice(0, body.top_k) }); return }
          lists++
          const page = Number(url.searchParams.get('page') || 1)
          send(200, { count: selected.length, results: selected.slice(page - 1, page), next: page < selected.length ? `?page=${page + 1}&page_size=1` : null }); return
        }
        if (req.method === 'POST' && url.pathname === '/v3/memories/add/') {
          if (body.user_id !== 'alice' || !body.messages?.[0]?.content) { send(400, {}); return }
          const row = { id: `added-${++adds}`, memory: body.messages[0].content, user_id: body.user_id, metadata: body.metadata || {} }
          records.push(row)
          if (body.infer === false) { send(200, { status: 'SUCCEEDED', results: [row] }); return }
          eventRecord = row; eventReads = 0; send(200, { event_id: eventId, status: 'PENDING' }); return
        }
        if (req.method === 'GET' && url.pathname === `/v1/event/${eventId}/`) {
          send(200, { id: eventId, event_type: 'ADD', status: ++eventReads === 1 ? 'RUNNING' : 'SUCCEEDED', results: [eventRecord] }); return
        }
        const target = records.find(row => url.pathname === `/v1/memories/${row.id}/`)
        if (target && req.method === 'PUT') { target.memory = body.text; target.metadata = { ...target.metadata, ...body.metadata }; send(200, target); return }
        if (target && req.method === 'DELETE') { records.splice(records.indexOf(target), 1); send(200, {}); return }
        send(404, {})
      } catch { send(500, {}) }
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('V3 fixture did not start')
  let provider: Mem0MemoryProvider | undefined
  try {
    saveConfig({ memoryEngineProvider: 'mem0-platform-engine', memorySyncBaseUrl: `http://127.0.0.1:${address.port}/v3`, memorySyncApiKey: 'v3-fixture', memorySyncUserId: 'alice' })
    provider = new Mem0MemoryProvider(join(app.getPath('userData'), 'v3-fixture'), getConfig(), 'platform'); provider.initialize()
    const snapshot = await provider.refreshRemoteList()
    if (!snapshot.complete || snapshot.remoteCount !== 2 || lists !== 2 || provider.list({ status: 'all' }).some(row => row.content === '其他用户')) throw new Error('V3 pagination or user filtering failed')
    if ((await provider.searchRemote('第一条')).length !== 1) throw new Error('V3 filters search failed')
    const raw = await provider.rememberRaw('V3 异步记录')
    if (raw.length !== 1 || eventReads !== 2 || adds !== 1) throw new Error('V3 async write was not confirmed exactly once')
    const created = await provider.createActiveConfirmed({ type: 'project', content: 'V3 同步记录', importance: .8, confidence: 1, sensitivity: 'normal' })
    await provider.updateConfirmed(created.id, { content: 'V3 修改已确认', importance: .7 })
    if (provider.list({ query: '修改已确认' }).length !== 1) throw new Error('V3 confirmed update failed')
    await provider.deleteConfirmed(created.id)
    if (provider.list({ status: 'all' }).some(row => row.id === created.id)) throw new Error('V3 confirmed deletion failed')
    authFailure = true
    const before = JSON.stringify(provider.list({ status: 'all' }))
    let rejected = false
    try { await provider.refreshRemoteList() } catch { rejected = true }
    if (!rejected || before !== JSON.stringify(provider.list({ status: 'all' }))) throw new Error('V3 failed refresh changed cache')
    if (!seen.some(path => path.startsWith('PUT /v1/memories/')) || !seen.some(path => path.startsWith('DELETE /v1/memories/'))) throw new Error('V3 used wrong management endpoints')
    console.log('CHOUYU_MEM0_V3_SMOKE_PASSED scoped pagination/search, synchronous and async add, v1 update/delete and failure retention')
  } finally { provider?.close(); saveConfig(original); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
}
