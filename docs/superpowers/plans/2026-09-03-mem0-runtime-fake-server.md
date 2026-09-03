# Mem0 Runtime Fake Server 冒烟测试 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Electron 冒烟测试内加入主进程内嵌的 fake Mem0 self-hosted server，覆盖 Mem0 主引擎的引擎切换、连接、检索、写入、三类故障与恢复。

**Architecture:** 新增两个主进程模块——`fake-mem0-server.ts`（纯 Node http 的假 Mem0 服务，可四模式切换并记录请求日志）和 `mem0-smoke.ts`（阶段编排断言）——由 `index.ts` 冒烟块末尾调用。fake server 不 import 任何 Electron 模块，可被 vitest 直接测试；阶段编排依赖 Electron 服务，由真实 Electron 冒烟验证。

**Tech Stack:** Electron 33 主进程、Node `http`、Vitest 2、better-sqlite3（经由现有 service）。

**Spec:** `docs/superpowers/specs/2026-09-03-mem0-runtime-fake-server-design.md`

**关键背景（实现者必读）：**

- 冒烟机制：`scripts/smoke-electron.js` spawn Electron，env `CHOUYU_SMOKE_TEST=1` + 临时 userData；主进程 `src/main/index.ts` 的 `whenReady` 内 `if (isSmokeTest)` 块做断言；renderer 加载完成后打印 `CHOUYU_SMOKE_READY`；外部脚本等 READY 或超时。
- 引擎切换：`saveConfig(patch)`（`src/main/database.ts:310`）改 `memoryEngineProvider` 等字段 → `closeMemory()`（`src/main/memory/service.ts:63`）→ `initializeMemory()`（service.ts:36）按新配置重建 provider。字段名：`memoryEngineProvider`、`memorySyncBaseUrl`、`memorySyncApiKey`、`memorySyncUserId`。
- 被测真实路径：`testMemoryEngine()`（service.ts:321，返回 `{ok, provider, message, remoteCount?}`）、`searchMemories()`（service.ts:380，远程模式直接走 `searchRemote`，无内部 catch）、`Mem0MemoryProvider.rememberRaw/createActive`（`src/main/memory/mem0-provider.ts`，createActive 触发 fire-and-forget `enqueueRemote` → `remote.push`）。
- 适配器端点（`src/main/memory/sync/mem0-adapter.ts`）：`joinApiUrl` 把 baseUrl + 端点拼成 `http://127.0.0.1:<port>/memories` 形式；搜索依次尝试 `memories/search`、`memories/search/`、`search`、`search/`，全 404 后退回 `GET /memories` 列表 + 本地 bigram 排序（`recallFromList`，要求 query 是内容的连续子串才有 exact 分）；鉴权用 `X-API-Key` 头（self-hosted）；写入 POST body 为 `{messages: [{role:'user', content}], user_id, infer, metadata?}`，响应行读取 `memory` 字段。
- 能力注册：`mem0-self-hosted-engine` 工厂在 `src/main/capabilities/builtins.ts:36`；`capabilityRegistry.list(config)` 的 `active` 按 `config.memoryEngineProvider === definition.id` 判定。
- vitest 只收集 `src/**/*.{test,spec}.ts`（vitest.config.ts）。

---

### Task 1: fake Mem0 server（TDD）

**Files:**
- Create: `src/main/smoke/fake-mem0-server.ts`
- Test: `src/main/smoke/fake-mem0-server.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/main/smoke/fake-mem0-server.test.ts`：

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { startFakeMem0Server, type FakeMem0Server } from './fake-mem0-server'

let server: FakeMem0Server | null = null

afterEach(async () => {
  await server?.close()
  server = null
})

const start = async () => {
  server = await startFakeMem0Server({
    apiKey: 'test-key',
    seed: [
      { userId: 'alice', memory: '用户偏好简短回答' },
      { userId: 'alice', memory: 'ChouYu 项目使用 SQLite 记忆' },
      { userId: 'bob', memory: 'Bob 的私人记忆' }
    ]
  })
  return server
}

describe('fake Mem0 server', () => {
  it('lists records scoped to the requesting user', async () => {
    const fake = await start()
    const response = await fetch(`${fake.url}/memories?user_id=alice&page_size=1000`, {
      headers: { 'X-API-Key': 'test-key' }
    })
    expect(response.status).toBe(200)
    const rows = await response.json()
    expect(rows).toHaveLength(2)
    expect(rows.map((row: { memory: string }) => row.memory)).toEqual(expect.arrayContaining(['用户偏好简短回答']))
  })

  it('rejects a missing or wrong X-API-Key with 401', async () => {
    const fake = await start()
    const response = await fetch(`${fake.url}/memories?user_id=alice`)
    expect(response.status).toBe(401)
  })

  it('stores writes with infer and metadata echoed back', async () => {
    const fake = await start()
    const response = await fetch(`${fake.url}/memories`, {
      method: 'POST',
      headers: { 'X-API-Key': 'test-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: '新写入的记忆' }],
        user_id: 'alice',
        infer: false,
        metadata: { chouyu_id: 'local-1' }
      })
    })
    expect(response.status).toBe(200)
    const rows = await response.json()
    expect(rows[0].memory).toBe('新写入的记忆')
    expect(fake.records().some((record) => record.userId === 'alice' && record.memory === '新写入的记忆' && record.metadata.chouyu_id === 'local-1')).toBe(true)
    expect(fake.requests().some((entry) => entry.method === 'POST' && entry.path === 'memories' && entry.apiKey === 'test-key' && entry.body?.infer === false)).toBe(true)
  })

  it('filters search results by normalized substring across path variants', async () => {
    const fake = await start()
    for (const path of ['memories/search', 'memories/search/', 'search', 'search/']) {
      const response = await fetch(`${fake.url}/${path}`, {
        method: 'POST',
        headers: { 'X-API-Key': 'test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '简短回答', user_id: 'alice', limit: 6 })
      })
      expect(response.status).toBe(200)
      const rows = await response.json()
      expect(rows).toHaveLength(1)
      expect(rows[0].memory).toBe('用户偏好简短回答')
    }
  })

  it('returns 404 for every search path in search-missing mode while list still works', async () => {
    const fake = await start()
    fake.setMode('search-missing')
    for (const path of ['memories/search', 'search']) {
      const response = await fetch(`${fake.url}/${path}`, {
        method: 'POST',
        headers: { 'X-API-Key': 'test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '简短回答', user_id: 'alice' })
      })
      expect(response.status).toBe(404)
    }
    const listResponse = await fetch(`${fake.url}/memories?user_id=alice`, { headers: { 'X-API-Key': 'test-key' } })
    expect(listResponse.status).toBe(200)
  })

  it('rejects every endpoint with 401 in auth mode', async () => {
    const fake = await start()
    fake.setMode('auth')
    const list = await fetch(`${fake.url}/memories?user_id=alice`, { headers: { 'X-API-Key': 'test-key' } })
    expect(list.status).toBe(401)
    const search = await fetch(`${fake.url}/memories/search`, {
      method: 'POST',
      headers: { 'X-API-Key': 'test-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '简短回答', user_id: 'alice' })
    })
    expect(search.status).toBe(401)
  })

  it('destroys sockets in refuse mode', async () => {
    const fake = await start()
    fake.setMode('refuse')
    await expect(fetch(`${fake.url}/memories?user_id=alice`, { headers: { 'X-API-Key': 'test-key' } })).rejects.toThrow()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest --run src/main/smoke/fake-mem0-server.test.ts`
Expected: FAIL — `Cannot find module './fake-mem0-server'`（或等价的模块不存在错误）。

- [ ] **Step 3: 实现 fake server**

创建 `src/main/smoke/fake-mem0-server.ts`（不 import 任何 electron 模块）：

```ts
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
    requests.push({ method: request.method || '', path, apiKey: request.headers['x-api-key'] as string || '', body })

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
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest --run src/main/smoke/fake-mem0-server.test.ts`
Expected: PASS（7 个用例全绿）。

- [ ] **Step 5: 提交**

```bash
git add src/main/smoke/fake-mem0-server.ts src/main/smoke/fake-mem0-server.test.ts
git commit -m "feat: add fake Mem0 self-hosted server for runtime smoke"
```

---

### Task 2: Mem0 冒烟阶段编排

**Files:**
- Create: `src/main/smoke/mem0-smoke.ts`

此文件 import 了依赖 Electron 的 service/database 模块，无法进 vitest；正确性由 Task 4 的真实 Electron 冒烟验证。

- [ ] **Step 1: 实现阶段编排**

创建 `src/main/smoke/mem0-smoke.ts`：

```ts
import { getConfig, saveConfig } from '../database'
import { capabilityRegistry } from '../capabilities/registry'
import { Mem0MemoryProvider } from '../memory/mem0-provider'
import { closeMemory, getMemoryProvider, initializeMemory, searchMemories, testMemoryEngine } from '../memory/service'
import { startFakeMem0Server } from './fake-mem0-server'

const SMOKE_USER = 'smoke-user'
const SMOKE_KEY = 'smoke-key'
const RETRIEVAL_QUERY = '简短回答'
const RETRIEVAL_CONTENT = '用户偏好简短回答'
const ISOLATION_CONTENT = '其他用户的记忆不应被检索到'

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return predicate()
}

export async function runMem0RuntimeSmoke(): Promise<void> {
  const server = await startFakeMem0Server({
    apiKey: SMOKE_KEY,
    seed: [
      { userId: SMOKE_USER, memory: RETRIEVAL_CONTENT, metadata: { chouyu_type: 'preference' } },
      { userId: SMOKE_USER, memory: 'ChouYu 项目使用 SQLite 记忆' },
      { userId: 'other-user', memory: ISOLATION_CONTENT }
    ]
  })
  try {
    saveConfig({
      memoryEngineProvider: 'mem0-self-hosted-engine',
      memorySyncBaseUrl: server.url,
      memorySyncApiKey: SMOKE_KEY,
      memorySyncUserId: SMOKE_USER
    })
    closeMemory()
    initializeMemory()

    const provider = getMemoryProvider()
    if (!(provider instanceof Mem0MemoryProvider)) throw new Error('Mem0 runtime smoke expected Mem0MemoryProvider as the active engine')
    const activeEngines = capabilityRegistry.list(getConfig()).filter((item) => item.kind === 'memory-engine' && item.active)
    if (activeEngines.length !== 1 || activeEngines[0].id !== 'mem0-self-hosted-engine') throw new Error('Mem0 runtime engine capability smoke test failed')

    const connection = await testMemoryEngine()
    if (!connection.ok || connection.remoteCount !== 2) throw new Error(`Mem0 connection smoke test failed: ${connection.message}`)

    const results = await searchMemories(RETRIEVAL_QUERY, 6)
    if (!results.some((memory) => memory.content === RETRIEVAL_CONTENT)) throw new Error('Mem0 chat retrieval smoke test failed')
    if (results.some((memory) => memory.content === ISOLATION_CONTENT)) throw new Error('Mem0 user isolation smoke test failed')
    if (!provider.list({ status: 'all', limit: 2000 }).some((memory) => memory.content === RETRIEVAL_CONTENT)) throw new Error('Mem0 SQLite cache smoke test failed')
    if (!server.requests().some((entry) => entry.method === 'POST' && entry.path === 'memories/search' && entry.apiKey === SMOKE_KEY)) throw new Error('Mem0 search request log smoke test failed')

    const written = await provider.rememberRaw('冒烟写入：用户在上海工作')
    if (written.length === 0) throw new Error('Mem0 rememberRaw smoke test failed')
    if (!server.records().some((record) => record.userId === SMOKE_USER && record.memory.includes('上海工作'))) throw new Error('Mem0 remote write smoke test failed')

    const pushed = provider.createActive({ type: 'fact', content: '冒烟推送记忆', importance: 0.7, confidence: 1, sensitivity: 'normal' })
    const pushArrived = await waitFor(() => server.requests().some((entry) =>
      entry.method === 'POST' && entry.path === 'memories' && entry.body?.infer === false && (entry.body?.metadata as { chouyu_id?: string } | undefined)?.chouyu_id === pushed.id
    ), 2000)
    if (!pushArrived) throw new Error('Mem0 background push smoke test failed')

    server.setMode('auth')
    const authStatus = await testMemoryEngine()
    if (authStatus.ok || !authStatus.message.includes('认证失败')) throw new Error(`Mem0 auth failure smoke test failed: ${authStatus.message}`)
    let authSearchError = ''
    try {
      await searchMemories(RETRIEVAL_QUERY, 6)
    } catch (error) {
      authSearchError = error instanceof Error ? error.message : String(error)
    }
    if (!authSearchError.includes('认证失败')) throw new Error(`Mem0 auth search rejection smoke test failed: ${authSearchError}`)

    server.setMode('search-missing')
    const fallbackResults = await searchMemories(RETRIEVAL_QUERY, 6)
    if (!fallbackResults.some((memory) => memory.content === RETRIEVAL_CONTENT)) throw new Error('Mem0 search-missing fallback smoke test failed')

    server.setMode('refuse')
    const refuseStatus = await testMemoryEngine()
    if (refuseStatus.ok || !refuseStatus.message.includes('无法连接')) throw new Error(`Mem0 connection failure smoke test failed: ${refuseStatus.message}`)

    server.setMode('ok')
    const recovered = await testMemoryEngine()
    if (!recovered.ok) throw new Error(`Mem0 recovery smoke test failed: ${recovered.message}`)
    const recoveredResults = await searchMemories(RETRIEVAL_QUERY, 6)
    if (!recoveredResults.some((memory) => memory.content === RETRIEVAL_CONTENT)) throw new Error('Mem0 recovery retrieval smoke test failed')
  } finally {
    closeMemory()
    saveConfig({ memoryEngineProvider: 'chouyu-sqlite' })
    initializeMemory()
    await server.close()
  }
}
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck:node`
Expected: 无错误。（`memorySyncBaseUrl` 等四个字段名来自 `src/shared/config.ts:84-90`；`testMemoryEngine` 返回类型 `MemorySyncStatus` 定义在 `src/shared/memory.ts:181`。）

- [ ] **Step 3: 提交**

```bash
git add src/main/smoke/mem0-smoke.ts
git commit -m "feat: add Mem0 runtime smoke phase runner"
```

---

### Task 3: index.ts 接线 + 冒烟脚本加固

**Files:**
- Modify: `src/main/index.ts`（`whenReady` 内 `if (isSmokeTest)` 块，约 122-220 行）
- Modify: `scripts/smoke-electron.js:7`（TIMEOUT_MS）、exit 处理（约 86-89 行）

- [ ] **Step 1: index.ts 包 try/catch 并调用新阶段**

在 `src/main/index.ts` 顶部 import 区加入：

```ts
import { runMem0RuntimeSmoke } from './smoke/mem0-smoke'
```

把 `if (isSmokeTest) { ... }`（现有 122-220 行的整个断言块）改为：

```ts
  if (isSmokeTest) {
    try {
      // ……现有 122-220 行的断言内容原样保留，整体缩进一层……

      await runMem0RuntimeSmoke()
    } catch (error) {
      console.error(`CHOUYU_SMOKE_FAILED stage=main message=${error instanceof Error ? error.message : String(error)}`)
      app.exit(1)
      return
    }
  }
```

要点：现有断言内容一字不改，只加缩进；`await runMem0RuntimeSmoke()` 放在现有断言之后（`getMemoryInsights` 检查之后）；catch 里 `app.exit(1)` 后 `return` 阻止后续插件/窗口初始化。

- [ ] **Step 2: 冒烟脚本超时与失败识别**

`scripts/smoke-electron.js` 第 7 行：

```js
const TIMEOUT_MS = 30_000
```

`child.on('exit', ...)` 中 `if (!ready)` 分支改为：

```js
child.on('exit', (code) => {
  if (!ready) {
    if (output.includes('CHOUYU_SMOKE_FAILED')) {
      finish(1, `Main-process smoke assertions failed.\n${output}`)
      return
    }
    finish(1, `Electron exited before renderer readiness (code ${code}).\n${output}`)
    return
  }
```

（其余分支不动。）

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck:node`
Expected: 无错误。

- [ ] **Step 4: 提交**

```bash
git add src/main/index.ts scripts/smoke-electron.js
git commit -m "feat: wire Mem0 runtime smoke into Electron smoke gate"
```

---

### Task 4: 全量门禁 + 文档收尾

**Files:**
- Modify: `docs/roadmap.md`（P1.5 最后一项勾选）
- Modify: `docs/current-status.md`（工程验证段落）

- [ ] **Step 1: 跑全量单测**

Run: `npm run test`
Expected: 全部通过（128 + 7 = 135 项左右，以实际数量为准）。

- [ ] **Step 2: 跑类型检查**

Run: `npm run typecheck`
Expected: node 与 web 均无错误。

- [ ] **Step 3: 构建并跑 Electron 冒烟**

Run: `npm run test:smoke`
Expected: 构建成功，末尾输出 `Electron smoke test passed.`。新增的 Mem0 阶段在主进程内执行，正常时无额外输出。

- [ ] **Step 4: 验证失败路径真的会失败（一次性人工验证，不提交改动）**

临时把 `src/main/smoke/mem0-smoke.ts` 中 `connection.remoteCount !== 2` 改成 `connection.remoteCount !== 3`，再跑 `npm run test:smoke`，确认输出包含 `CHOUYU_SMOKE_FAILED stage=main` 且进程以非零码结束（10 秒内，不等 30 秒超时）。验证后改回。

Run: `npm run test:smoke`
Expected: FAIL，输出含 `Main-process smoke assertions failed` 与 `CHOUYU_SMOKE_FAILED stage=main message=Mem0 connection smoke test failed`。改回后重跑应恢复 PASS。

- [ ] **Step 5: 更新 roadmap**

`docs/roadmap.md` P1.5 一节，把：

```markdown
- [ ] 用 Electron runtime fake server 覆盖 Mem0 主引擎连接和错误恢复
```

改为：

```markdown
- [x] 用 Electron runtime fake server 覆盖 Mem0 主引擎连接和错误恢复
```

- [ ] **Step 6: 更新 current-status**

`docs/current-status.md` 工程验证第一段（"当前自动化质量门禁包括……"所在段落）末尾追加一句：

```markdown
Electron 启动冒烟新增 Mem0 主引擎阶段：主进程内嵌 fake self-hosted server，覆盖引擎切换、连接测试、聊天检索、后台写入，以及 401 认证失败、搜索端点 404 退回列表召回、连接掐断与恢复的完整故障矩阵。
```

- [ ] **Step 7: 提交**

```bash
git add docs/roadmap.md docs/current-status.md
git commit -m "docs: mark Mem0 runtime smoke coverage complete"
```

---

## 完成标准

- `npm run typecheck`、`npm run test`、`npm run test:smoke` 全绿。
- 故障注入验证（Task 4 Step 4）证明断言失败会让冒烟以非零码快速失败。
- roadmap P1.5 全部勾选，current-status 工程验证段落提及新覆盖。
