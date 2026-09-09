import { getConfig, saveConfig } from '../database'
import { capabilityRegistry } from '../capabilities/registry'
import { Mem0MemoryProvider } from '../memory/mem0-provider'
import { closeMemory, getMemoryProvider, importMemories, initializeMemory, searchMemories, testMemoryEngine } from '../memory/service'
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

    const pushed = await provider.createActiveConfirmed({ type: 'fact', content: '冒烟推送记忆', importance: 0.7, confidence: 1, sensitivity: 'normal' })
    const pushArrived = await waitFor(() => server.requests().some((entry) =>
      entry.method === 'POST' && entry.path === 'memories' && entry.body?.infer === false && (entry.body?.metadata as { chouyu_id?: string } | undefined)?.chouyu_id === pushed.id
    ), 2000)
    if (!pushArrived) throw new Error('Mem0 background push smoke test failed')

    server.setMode('auth')
    const candidate = provider.createCandidate({ type: 'fact', content: '确认写入失败后重试的候选', importance: 0.6, confidence: 1, sensitivity: 'normal' })!
    let approveRejected = false
    try { await provider.approveConfirmed(candidate.id) } catch { approveRejected = true }
    if (!approveRejected || provider.list({ status: 'pending' }).every(item => item.id !== candidate.id)) throw new Error('Failed approval did not preserve pending candidate')
    let updateRejected = false, deleteRejected = false
    try { await provider.updateConfirmed(written[0].id, { content: '不应保存的更新' }) } catch { updateRejected = true }
    try { await provider.deleteConfirmed(written[0].id) } catch { deleteRejected = true }
    if (!updateRejected || !deleteRejected || !provider.list({ status: 'all' }).some(item => item.id === written[0].id && item.content.includes('上海工作'))) throw new Error('Mem0 failed mutation did not preserve local cache')
    server.setMode('ok')
    await provider.approveConfirmed(candidate.id)
    if (!server.records().some(item => item.metadata.chouyu_id === candidate.id) || !provider.list({ status: 'active' }).some(item => item.id === candidate.id)) throw new Error('Approval retry was not confirmed in both stores')
    await provider.deleteConfirmed(candidate.id)
    await provider.updateConfirmed(written[0].id, { content: '冒烟更新：用户在杭州工作' })
    if (!server.records().some(item => item.memory.includes('杭州工作')) || server.records().some(item => item.memory.includes('上海工作'))) throw new Error('Mem0 confirmed update did not reach remote')
    const revision = provider.listRevisions(written[0].id).find(item => item.content.includes('上海工作'))!
    server.setMode('auth')
    let restoreRejected = false
    try { await provider.restoreRevisionConfirmed(written[0].id, revision.id) } catch { restoreRejected = true }
    if (!restoreRejected || !provider.list({ status: 'active' }).some(item => item.id === written[0].id && item.content.includes('杭州工作'))) throw new Error('Failed restoration changed local memory')
    server.setMode('ok')
    await provider.restoreRevisionConfirmed(written[0].id, revision.id)
    if (!server.records().some(item => item.memory.includes('上海工作'))) throw new Error('Restored revision did not reach remote')
    await provider.updateConfirmed(written[0].id, { content: '冒烟更新：用户在杭州工作' })

    const importDecision = { item: { id: 'import-smoke', candidate: { type: 'project' as const, content: '导入验收项目使用测试数据库', importance: 0.6, confidence: 1, sensitivity: 'normal' as const }, status: 'new' as const, suggestedAction: 'add' as const }, action: 'add' as const }
    server.setMode('auth')
    const failedImport = await importMemories([importDecision])
    if (failedImport.failed !== 1 || failedImport.added !== 0) throw new Error('Failed import was reported as successful')
    server.setMode('ok')
    const retriedImport = await importMemories([importDecision])
    if (retriedImport.added !== 1 || retriedImport.skipped !== 0 || !server.records().some(item => item.memory === importDecision.item.candidate.content)) throw new Error('Import retry did not confirm pending record')
    console.log('CHOUYU_MEM0_HISTORY_IMPORT_SMOKE_PASSED restoration, failure preservation, import failure and retry')
    server.setMode('auth')
    let archiveRejected = false
    try { await provider.archiveManyConfirmed([written[0].id], 'manual') } catch { archiveRejected = true }
    if (!archiveRejected || !provider.list({ status: 'active' }).some(item => item.id === written[0].id)) throw new Error('Failed archive changed local status')
    server.setMode('ok')
    await provider.archiveManyConfirmed([written[0].id], 'manual')
    if ((await provider.searchRemote('杭州工作')).length) throw new Error('Archived memory was recalled')
    server.setMode('auth')
    let reactivationRejected = false
    try { await provider.reactivateConfirmed(written[0].id) } catch { reactivationRejected = true }
    if (!reactivationRejected || !provider.list({ status: 'archived' }).some(item => item.id === written[0].id)) throw new Error('Failed reactivation changed local status')
    server.setMode('ok')
    await provider.reactivateConfirmed(written[0].id)
    if (!(await provider.searchRemote('杭州工作')).some(item => item.id === written[0].id)) throw new Error('Reactivated memory was not recalled')
    console.log('CHOUYU_MEM0_ARCHIVE_SMOKE_PASSED archive, excluded recall, reactivation, failure preservation')
    const replacement = provider.createCandidate({ type: 'fact', content: '冲突替换：用户在苏州工作', importance: 0.7, confidence: 1, sensitivity: 'normal' })!
    provider.createConflict(replacement.id, written[0].id, 'update', '合成替换验收')
    server.setMode('reject-create')
    let partialRejected = false
    try { await provider.resolveConflictConfirmed(replacement.id, 'replace') } catch (error) { partialRejected = error instanceof Error && error.message.includes('已归档 1 条') }
    if (!partialRejected || !provider.list({ status: 'pending' }).some(item => item.id === replacement.id) || !provider.list({ status: 'archived' }).some(item => item.id === written[0].id)) throw new Error('Partial conflict failure was not preserved accurately')
    server.setMode('ok')
    await provider.resolveConflictConfirmed(replacement.id, 'replace')
    if ((await provider.searchRemote('杭州工作')).length || !(await provider.searchRemote('苏州工作')).some(item => item.id === replacement.id)) throw new Error('Conflict retry did not replace remote recall')
    await provider.deleteConfirmed(replacement.id)
    await provider.reactivateConfirmed(written[0].id)
    console.log('CHOUYU_MEM0_CONFLICT_SMOKE_PASSED partial replacement failure, retry, remote recall, original recovery')
    const concurrent = provider.createCandidate({ type: 'fact', content: '冲突并存：用户也在南京工作', importance: 0.7, confidence: 1, sensitivity: 'normal' })!
    provider.createConflict(concurrent.id, written[0].id, 'update', '合成并存验收')
    await provider.resolveConflictConfirmed(concurrent.id, 'keep')
    if (!(await provider.searchRemote('杭州工作')).some(item => item.id === written[0].id) || !(await provider.searchRemote('南京工作')).some(item => item.id === concurrent.id)) throw new Error('Conflict keep did not preserve both records')
    await provider.deleteConfirmed(concurrent.id)
    const rejected = provider.createCandidate({ type: 'fact', content: '冲突拒绝：未确认城市', importance: 0.7, confidence: 1, sensitivity: 'normal' })!
    provider.createConflict(rejected.id, written[0].id, 'update', '合成拒绝验收')
    const writesBeforeReject = server.requests().filter(item => item.method !== 'GET').length
    await provider.resolveConflictConfirmed(rejected.id, 'reject')
    if (server.requests().filter(item => item.method !== 'GET').length !== writesBeforeReject || provider.list({ status: 'all' }).some(item => item.id === rejected.id)) throw new Error('Conflict rejection wrote remote state or retained candidate')
    closeMemory()
    initializeMemory()
    const restarted = getMemoryProvider() as Mem0MemoryProvider
    await restarted.deleteConfirmed(written[0].id)
    if (server.records().some(item => item.memory.includes('杭州工作')) || restarted.list({ status: 'all' }).some(item => item.id === written[0].id)) throw new Error('Mem0 confirmed delete after restart did not clear both stores')
    if ((await restarted.searchRemote('杭州工作')).length) throw new Error('Deleted remote memory resurfaced')
    console.log('CHOUYU_MEM0_MUTATION_SMOKE_PASSED confirmed update/delete, failure preservation, restart mapping')

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

    const userA = getMemoryProvider() as Mem0MemoryProvider
    const privateCandidate = userA.createCandidate({ type: 'fact', content: '仅属于 A 的待确认候选', importance: 0.6, confidence: 1, sensitivity: 'normal' })!
    const lateSearch = userA.searchRemote(RETRIEVAL_QUERY).then(() => false, () => true)
    saveConfig({ memorySyncUserId: 'other-user' })
    const userB = getMemoryProvider() as Mem0MemoryProvider
    if (userB === userA || userB.list({ status: 'all' }).length) throw new Error('Mem0 cache leaked across user switch')
    if (!await lateSearch) throw new Error('Old user search was accepted after configuration switched')
    await userB.searchRemote(ISOLATION_CONTENT)
    if (userB.list({ status: 'all' }).some(item => item.content === RETRIEVAL_CONTENT || item.id === privateCandidate.id)) throw new Error('Previous user records leaked into the new cache')
    let foreignDeleteRejected = false
    try { await userB.deleteConfirmed(privateCandidate.id) } catch { foreignDeleteRejected = true }
    if (!foreignDeleteRejected) throw new Error('Previous user ID was accepted for deletion')
    saveConfig({ memoryEngineProvider: 'chouyu-sqlite' })
    if (getMemoryProvider().list({ status: 'all' }).some(item => item.content === ISOLATION_CONTENT || item.id === privateCandidate.id)) throw new Error('Remote cache leaked into local engine')
    saveConfig({ memoryEngineProvider: 'mem0-self-hosted-engine', memorySyncUserId: SMOKE_USER })
    if (!getMemoryProvider().list({ status: 'pending' }).some(item => item.id === privateCandidate.id)) throw new Error('Original user candidate did not survive switching back')
    console.log('CHOUYU_MEM0_SCOPE_SMOKE_PASSED user switch, stale response, foreign ID, local engine, return to original cache')
    const toClear = getMemoryProvider() as Mem0MemoryProvider
    const beforeClear = toClear.list({ status: 'all' }).length
    server.setMode('auth')
    let clearRejected = false
    try { await toClear.clearConfirmed() } catch { clearRejected = true }
    if (!clearRejected || toClear.list({ status: 'all' }).length !== beforeClear) throw new Error('Failed clear removed local records')
    server.setMode('ok')
    await toClear.clearConfirmed()
    if (toClear.list({ status: 'all' }).length || server.records().some(item => item.userId === SMOKE_USER)) throw new Error('Clear left local or uncached remote records behind')
    if (!server.records().some(item => item.userId === 'other-user' && item.memory === ISOLATION_CONTENT)) throw new Error('Clear modified another user')
    let legacyRejected = false
    try { toClear.createActive({ type: 'fact', content: '不得后台写入', importance: 0.6, confidence: 1, sensitivity: 'normal' }) } catch { legacyRejected = true }
    if (!legacyRejected || toClear.list({ status: 'all' }).length) throw new Error('Legacy synchronous mutation changed local state')
    console.log('CHOUYU_MEM0_CLEAR_SMOKE_PASSED remote-only records, pending candidates, failure preservation, user isolation, legacy guard')
    const refreshPending = toClear.createCandidate({ type: 'fact', content: '刷新必须保留的本地候选', importance: .6, confidence: 1, sensitivity: 'normal' })
    const remoteWrite = await fetch(`${server.url}/memories`, { method: 'POST', headers: { 'X-API-Key': SMOKE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: SMOKE_USER, messages: [{ role: 'user', content: '远端独有的刷新记录' }], infer: false }) })
    if (!remoteWrite.ok) throw new Error('Refresh seed failed')
    const partial = await toClear.refreshRemoteList()
    const refreshed = toClear.list({ status: 'active' }).find(item => item.content === '远端独有的刷新记录')
    if (partial.complete || partial.remoteCount !== 1 || !refreshed) throw new Error('Legacy remote refresh failed')
    const metadataFixture = server.records().find(item => item.userId === SMOKE_USER)!
    const expiry = Date.now() + 86_400_000
    metadataFixture.metadata = { chouyu_type: 'workflow', chouyu_importance: .9, chouyu_sensitivity: 'sensitive', chouyu_status: 'archived', chouyu_expires_at: expiry, chouyu_source_session_id: 'remote-session', chouyu_source_message_id: 'remote-message' }
    await toClear.refreshRemoteList()
    const archivedMetadata = toClear.list({ status: 'all' }).find(item => item.id === refreshed.id)!
    if (archivedMetadata.type !== 'workflow' || archivedMetadata.importance !== .9 || archivedMetadata.sensitivity !== 'sensitive' || archivedMetadata.status !== 'archived' || archivedMetadata.expiresAt !== expiry || archivedMetadata.sourceSessionId !== 'remote-session') throw new Error('Remote attributes were not applied')
    metadataFixture.metadata = { chouyu_status: 'active' }
    await toClear.refreshRemoteList()
    const activeMetadata = toClear.list({ status: 'active' }).find(item => item.id === refreshed.id)!
    if (!activeMetadata || activeMetadata.expiresAt !== expiry || activeMetadata.type !== 'workflow' || activeMetadata.sensitivity !== 'sensitive') throw new Error('Reactivation cleared absent remote attributes')
    const revisionCount = toClear.listRevisions(refreshed.id).length
    await toClear.refreshRemoteList()
    if (toClear.list({ status: 'active' }).find(item => item.id === refreshed.id)!.updatedAt !== activeMetadata.updatedAt || toClear.listRevisions(refreshed.id).length !== revisionCount) throw new Error('Unchanged refresh rewrote metadata or revisions')
    metadataFixture.metadata = { chouyu_expires_at: null, chouyu_source_session_id: null, chouyu_source_message_id: null }
    await toClear.refreshRemoteList()
    const clearedMetadata = toClear.list({ status: 'active' }).find(item => item.id === refreshed.id)!
    if (clearedMetadata.expiresAt || clearedMetadata.sourceSessionId || clearedMetadata.sourceMessageId) throw new Error('Explicit remote null did not clear nullable attributes')
    metadataFixture.metadata = { chouyu_importance: 'invalid' }; metadataFixture.memory = '不得部分写入的正文'
    let metadataRejected = false
    try { await toClear.refreshRemoteList() } catch { metadataRejected = true }
    if (!metadataRejected || toClear.list({ status: 'active' }).find(item => item.id === refreshed.id)!.content !== refreshed.content) throw new Error('Invalid remote metadata partially updated cache')
    metadataFixture.metadata = {}; metadataFixture.memory = refreshed.content
    console.log('CHOUYU_MEM0_ATTRIBUTES_SMOKE_PASSED type, importance, sensitivity, expiry, source links, reactivation, idempotence and invalid metadata rollback')
    const remoteRefreshId = server.records().find(item => item.userId === SMOKE_USER)!.id
    await fetch(`${server.url}/memories/${remoteRefreshId}`, { method: 'DELETE', headers: { 'X-API-Key': SMOKE_KEY } })
    await toClear.refreshRemoteList()
    if (!toClear.list({ status: 'active' }).some(item => item.id === refreshed.id)) throw new Error('Unverified list removed cache')
    server.setMode('auth')
    let refreshFailed = false
    try { await toClear.refreshRemoteList() } catch { refreshFailed = true }
    if (!refreshFailed || !toClear.list({ status: 'active' }).some(item => item.id === refreshed.id)) throw new Error('Failed refresh changed cache')
    server.setMode('ok'); server.setListEnvelope(true)
    const complete = await toClear.refreshRemoteList()
    if (!complete.complete || complete.removed !== 1 || toClear.list({ status: 'active' }).length || !toClear.list({ status: 'pending' }).some(item => item.id === refreshPending?.id)) throw new Error('Complete refresh did not reconcile cache or preserve candidate')
    for (let index = 0; index < 2; index++) {
      const response = await fetch(`${server.url}/memories`, { method: 'POST', headers: { 'X-API-Key': SMOKE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: SMOKE_USER, messages: [{ role: 'user', content: '同文不同远端 ID 的冲突样例' }], infer: false }) })
      if (!response.ok) throw new Error('Refresh conflict fixture failed')
    }
    let conflictRejected = false
    try { await toClear.refreshRemoteList() } catch { conflictRejected = true }
    if (!conflictRejected || toClear.list({ status: 'active' }).length || !toClear.list({ status: 'pending' }).some(item => item.id === refreshPending?.id)) throw new Error('Refresh mapping conflict did not roll back the full transaction')
    console.log('CHOUYU_MEM0_REFRESH_SMOKE_PASSED remote-only import, incomplete-list retention, failure preservation, complete deletion and pending preservation')
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
