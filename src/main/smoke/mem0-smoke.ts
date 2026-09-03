import { getConfig, saveConfig } from '../database'
import { capabilityRegistry } from '../capabilities/registry'
import { Mem0MemoryProvider } from '../memory/mem0-provider'
import { closeMemory, getMemoryProvider, initializeMemory, searchMemories, testMemoryEngine } from '../memory/service'
import { startFakeMem0Server } from './fake-mem0-server'

const SMOKE_USER = 'smoke-user'
const SMOKE_KEY = 'smoke-key'
const RETRIEVAL_QUERY = '简短回答'
const RETRIEVAL_CONTENT = '用户偏好简短回答（Mem0 冒烟）'
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
    if (!server.requests().some((entry) => entry.method === 'POST' && entry.path === 'memories/search' && entry.apiKey === SMOKE_KEY && entry.body?.query === RETRIEVAL_QUERY)) throw new Error('Mem0 search request log smoke test failed')

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
    let refuseSearchError = ''
    try {
      await searchMemories(RETRIEVAL_QUERY, 6)
    } catch (error) {
      refuseSearchError = error instanceof Error ? error.message : String(error)
    }
    if (!refuseSearchError.includes('无法连接')) throw new Error(`Mem0 refuse search rejection smoke test failed: ${refuseSearchError}`)

    server.setMode('ok')
    const recovered = await testMemoryEngine()
    if (!recovered.ok) throw new Error(`Mem0 recovery smoke test failed: ${recovered.message}`)
    const recoveredResults = await searchMemories(RETRIEVAL_QUERY, 6)
    if (!recoveredResults.some((memory) => memory.content === RETRIEVAL_CONTENT)) throw new Error('Mem0 recovery retrieval smoke test failed')
  } finally {
    try {
      closeMemory()
      saveConfig({ memoryEngineProvider: 'chouyu-sqlite' })
      initializeMemory()
    } catch (error) {
      console.warn('[Smoke] Mem0 phase restore failed:', error)
    }
    await server.close()
  }
}
