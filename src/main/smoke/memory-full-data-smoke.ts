import { SQLiteMemoryProvider } from '../memory/sqlite-provider'
import { Mem0MemoryProvider } from '../memory/mem0-provider'
import { startFakeMem0Server } from './fake-mem0-server'
import { getConfig, saveConfig } from '../database'
import { closeMemory, initializeMemory, createMemory, proposeMemoryCandidate, previewMemoryImport, importMemories, getMemoryProvider } from '../memory/service'

export async function runMemoryFullDataSmoke(): Promise<void> {
  const original = getConfig(), server = await startFakeMem0Server({ apiKey: 'full-data-key', seed: [] })
  closeMemory()
  saveConfig({ memoryEngineProvider: 'mem0-self-hosted-engine', memorySyncBaseUrl: server.url, memorySyncApiKey: 'full-data-key', memorySyncUserId: 'full-data-fixture', embeddingEnabled: false })
  try {
    initializeMemory()
    const provider = getMemoryProvider() as Mem0MemoryProvider
    const candidate = { type: 'fact' as const, content: '我的显示器是 4K', importance: .7, confidence: 1, sensitivity: 'normal' as const }
    // Seed only the isolated SQLite cache; no remote write is needed for lookup assertions.
    const seed = (value: typeof candidate | (Omit<typeof candidate, 'type'> & { type: 'project' })) => SQLiteMemoryProvider.prototype.createActive.call(provider, value)
    const oldest = seed(candidate)
    const pendingInput = { ...candidate, content: '我的显示器是 8K' }, pending = provider.createCandidate(pendingInput)!
    provider.createConflict(pending.id, oldest.id, 'contradiction', '合成旧冲突')
    for (let index = 0; index < 2100; index++) seed({ ...candidate, type: 'project', content: `完整数据合成记录 ${index}` })
    if (provider.list({ status: 'all', limit: 2000 }).some(row => row.id === oldest.id || row.id === pending.id)) throw new Error('Full-data fixture did not place targets beyond page ceiling')
    const exported = provider.exportAll()
    if (exported.length !== 2102 || !exported.some(row => row.id === oldest.id) || !exported.some(row => row.id === pending.id)) throw new Error('Memory export truncated old active or pending records')
    const duplicate = await createMemory(candidate)
    if (duplicate.id !== oldest.id || provider.exportAll().length !== 2102) throw new Error('Creating duplicate memory missed old active record')
    const repeated = await createMemory(pendingInput)
    if (repeated.id !== pending.id || repeated.status !== 'pending' || !repeated.conflicts?.some(row => row.status === 'pending')) throw new Error('Creating duplicate bypassed old pending conflict')
    const changed = proposeMemoryCandidate({ ...candidate, content: '我的显示器是 6K' })
    if (!changed?.conflicts?.some(row => row.existingMemoryId === oldest.id)) throw new Error('New candidate missed old active conflict')
    const preview = previewMemoryImport([candidate, { ...candidate, content: '我的显示器是 10K' }])
    let overLimitRejected = false
    try { previewMemoryImport(Array.from({ length: 2001 }, () => candidate)) } catch { overLimitRejected = true }
    if (!overLimitRejected) throw new Error('Oversized import silently truncated exported records')
    if (preview.items[0].status !== 'duplicate' || preview.items[1].status !== 'conflict') throw new Error('Import preview missed old duplicate or conflict')
    const retryPreview = previewMemoryImport([pendingInput])
    for (let index = 0; index < 2100; index++) provider.createCandidate({ ...candidate, type: 'project', content: `待处理完整数据合成记录 ${index}` })
    if (provider.list({ status: 'pending', limit: 2000 }).some(row => row.id === pending.id)) throw new Error('Import retry fixture did not exceed the pending page ceiling')
    const retried = await importMemories(retryPreview.items.map(item => ({ item, action: 'add' as const })))
    if (retried.failed !== 1 || provider.findByNormalizedKey(pending.normalizedKey)?.status !== 'pending') throw new Error('Import retry bypassed pending conflict')
    if ((await provider.createActiveConfirmed(candidate)).id !== oldest.id || server.requests().length) throw new Error('Mem0 duplicate lookup missed cached record or sent an unnecessary request')
    console.log('CHOUYU_MEMORY_FULL_DATA_SMOKE_PASSED 2102 export records, indexed duplicate/conflict lookup, import retry beyond 2100 pending records and Mem0 reuse without network writes')
  } finally { closeMemory(); saveConfig(original); initializeMemory(); await server.close() }
}
