import { createServer, type IncomingMessage, type ServerResponse } from 'http'

export type FakeMem0Mode = 'ok' | 'auth' | 'search-missing' | 'refuse'

export interface FakeMem0Record {
  id: string
  memory: string
  metadata: Record<string, unknown>
  userId: string
}

export interface FakeMem0RequestLogEntry {
  method: string
  path: string
  apiKey: string
  body: Record<string, unknown> | null
}

export interface FakeMem0Server {
  url: string
  setMode(mode: FakeMem0Mode): void
  records(): readonly FakeMem0Record[]
  requests(): readonly FakeMem0RequestLogEntry[]
  close(): Promise<void>
}

export interface FakeMem0Seed {
  userId: string
  memory: string
  metadata?: Record<string, unknown>
}

interface ReadBody {
  body: Record<string, unknown> | null
}

async function readJsonBody(request: IncomingMessage): Promise<ReadBody> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return { body: null }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return { body: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null }
  } catch {
    return { body: null }
  }
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '')
}

function serialize(record: FakeMem0Record): Record<string, unknown> {
  return { id: record.id, memory: record.memory, metadata: record.metadata }
}

export async function startFakeMem0Server(options: { apiKey: string; seed: ReadonlyArray<FakeMem0Seed> }): Promise<FakeMem0Server> {
  const apiKey = options.apiKey
  const records: FakeMem0Record[] = options.seed.map((item, index) => ({
    id: `seed-${index}`,
    memory: item.memory,
    metadata: item.metadata ? { ...item.metadata } : {},
    userId: item.userId
  }))
  const requests: FakeMem0RequestLogEntry[] = []
  let mode: FakeMem0Mode = 'ok'
  let nextId = records.length

  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) response.statusCode = 500
      response.end()
    })
  })

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    const path = url.pathname.replace(/\/+$/, '')
    const { body } = request.method === 'POST' ? await readJsonBody(request) : { body: null }
    requests.push({ method: request.method || '', path: path.replace(/^\//, ''), apiKey: request.headers['x-api-key'] as string || '', body })

    if (mode === 'refuse') {
      request.destroy()
      return
    }
    if (mode === 'auth') {
      response.statusCode = 401
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ detail: 'unauthorized' }))
      return
    }

    const authorized = request.headers['x-api-key'] === apiKey
    const sendJson = (status: number, payload: unknown): void => {
      response.statusCode = status
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify(payload))
    }

    if (!authorized) {
      sendJson(401, { detail: 'unauthorized' })
      return
    }
    if (request.method === 'GET' && path === '/memories') {
      const userId = url.searchParams.get('user_id') || ''
      sendJson(200, records.filter((record) => record.userId === userId).map(serialize))
      return
    }
    if (request.method === 'POST' && (path === '/memories/search' || path === '/search')) {
      if (mode === 'search-missing') {
        sendJson(404, { detail: 'not found' })
        return
      }
      const query = normalizeText(typeof body?.query === 'string' ? body.query : '')
      const userId = typeof body?.user_id === 'string' ? body.user_id : ''
      sendJson(200, records
        .filter((record) => record.userId === userId && query.length > 0 && normalizeText(record.memory).includes(query))
        .map(serialize))
      return
    }
    if (request.method === 'POST' && path === '/memories') {
      const messages = Array.isArray(body?.messages) ? body!.messages : []
      const first = messages[0] as { content?: unknown } | undefined
      const content = first && typeof first.content === 'string' ? first.content : ''
      if (!content.trim()) {
        sendJson(400, { detail: 'empty messages' })
        return
      }
      const userId = typeof body?.user_id === 'string' ? body.user_id : ''
      const record: FakeMem0Record = {
        id: `m-${nextId}`,
        memory: content,
        metadata: body?.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? { ...(body.metadata as Record<string, unknown>) } : {},
        userId
      }
      nextId += 1
      records.push(record)
      sendJson(200, [serialize(record)])
      return
    }
    sendJson(404, { detail: 'not found' })
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fake Mem0 server failed to bind')

  return {
    url: `http://127.0.0.1:${address.port}`,
    setMode(next: FakeMem0Mode) { mode = next },
    records: () => records,
    requests: () => requests,
    close: () => {
      server.closeAllConnections()
      return new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}
