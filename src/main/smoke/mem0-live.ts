import { app } from 'electron'
import path from 'path'
import { randomUUID } from 'crypto'
import type { AppConfig } from '../../shared/config'
import type { MemoryRecord } from '../../shared/memory'
import { initDatabase, saveConfig } from '../database'
import { Mem0MemoryProvider } from '../memory/mem0-provider'
import { Mem0MemorySyncAdapter } from '../memory/sync/mem0-adapter'

export async function runMem0Acceptance(original: AppConfig, cleanupTarget?: { userId: string; testLocalId: string }) {
  const userId = cleanupTarget?.userId || `chouyu-acceptance-${randomUUID()}`
  const id = cleanupTarget?.testLocalId || randomUUID()
  if (!/^chouyu-acceptance-[a-f0-9-]{36}$/.test(userId) || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid test cleanup target')
  const config = { ...original, memoryEngineProvider: 'mem0-self-hosted-engine', memorySyncUserId: userId }
  const remote = new Mem0MemorySyncAdapter({ baseUrl: config.memorySyncBaseUrl, apiKey: config.memorySyncApiKey, userId, mode: 'self-hosted' })
  const checks: Array<{ name: string; passed: boolean }> = []
  let provider: Mem0MemoryProvider | undefined
  let scopeVerified = false
  let cleanupPassed = false
  let stage = 'list-isolated-user'
  let failureDetail = '', cleanupError = ''
  try {
    if (cleanupTarget) { scopeVerified = true; return await cleanupOnly() }
    const before = await remote.list()
    if (before.length !== 0) throw new Error('New test namespace unexpectedly contains records')
    scopeVerified = true
    checks.push({ name: 'empty-isolated-user', passed: true })
    const memory: MemoryRecord = { id, type: 'fact', content: `ChouYu 验收 ${id}：咖啡不加糖`, normalizedKey: id, keywords: [], importance: 0.5, confidence: 1, sensitivity: 'normal', status: 'active', createdAt: Date.now(), updatedAt: Date.now(), accessCount: 0, helpfulCount: 0, unhelpfulCount: 0 }
    stage = 'create'
    const push = await remote.push([memory])
    if (push.succeeded !== 1) throw new Error('Remote create failed')
    const records = await remote.list()
    const created = records.find(record => record.metadata.chouyu_id === id)
    if (!created) throw new Error('Created memory is not readable')
    checks.push({ name: 'create-and-read', passed: true })
    initDatabase()
    saveConfig(config)
    const filename = path.join(app.getPath('userData'), 'acceptance-memory.db')
    provider = new Mem0MemoryProvider(filename, config, 'self-hosted')
    provider.initialize()
    stage = 'confirmed-approval'
    const candidate = provider.createCandidate({ type: 'fact', content: `ChouYu 验收 ${id}：确认候选写入`, importance: 0.6, confidence: 1, sensitivity: 'normal' })!
    await provider.approveConfirmed(candidate.id)
    if (!(await remote.list()).some(record => record.metadata.chouyu_id === candidate.id && record.content === candidate.content)) throw new Error('Approved candidate not readable from remote')
    checks.push({ name: 'confirmed-approval', passed: true })
    await provider.deleteConfirmed(candidate.id)
    stage = 'search'
    const results = await provider.searchRemote(id, 6)
    const cached = results.find(record => record.content.includes(id))
    if (!cached) throw new Error('Remote search did not recall the test record')
    checks.push({ name: 'remote-search-cache', passed: true })
    const content = `ChouYu 验收 ${id}：改用无咖啡因饮品`
    stage = 'update'
    await provider.updateConfirmed(cached.id, { content })
    if (!(await remote.list()).some(record => record.id === created.id && record.content === content)) throw new Error('Updated content not readable from remote')
    checks.push({ name: 'confirmed-update', passed: true })
    stage = 'restore-revision'
    const revision = provider.listRevisions(cached.id).find(item => item.content === cached.content)
    if (!revision) throw new Error('Original content revision missing')
    await provider.restoreRevisionConfirmed(cached.id, revision.id)
    if (!(await remote.list()).some(record => record.id === created.id && record.content === cached.content)) throw new Error('Restored revision not readable from remote')
    checks.push({ name: 'confirmed-history-restoration', passed: true })
    stage = 'archive-and-reactivate'
    await provider.archiveManyConfirmed([cached.id], 'manual')
    if ((await provider.searchRemote(id)).some(record => record.id === cached.id)) throw new Error('Archived record was recalled')
    await provider.reactivateConfirmed(cached.id)
    if (!(await provider.searchRemote(id)).some(record => record.id === cached.id)) throw new Error('Reactivated record was not recalled')
    checks.push({ name: 'confirmed-archive-and-reactivate', passed: true })
    stage = 'conflict-replacement'
    const replacement = provider.createCandidate({ type: 'fact', content: `ChouYu 验收 ${id}：改喝温水`, importance: 0.6, confidence: 1, sensitivity: 'normal' })!
    provider.createConflict(replacement.id, cached.id, 'update', '合成替换验收')
    await provider.resolveConflictConfirmed(replacement.id, 'replace')
    const recalled = await provider.searchRemote(id)
    if (recalled.some(record => record.id === cached.id) || !recalled.some(record => record.id === replacement.id)) throw new Error('Conflict replacement recall mismatch')
    await provider.deleteConfirmed(replacement.id)
    await provider.reactivateConfirmed(cached.id)
    checks.push({ name: 'confirmed-conflict-replacement', passed: true })
    provider.close()
    provider = new Mem0MemoryProvider(filename, config, 'self-hosted')
    provider.initialize()
    stage = 'delete-after-restart'
    await provider.deleteConfirmed(cached.id)
    if ((await remote.list()).some(record => record.id === created.id)) throw new Error('Deleted record remains remote')
    checks.push({ name: 'restart-and-confirmed-delete', passed: true })
    stage = 'confirmed-clear'
    await provider.createActiveConfirmed({ type: 'fact', content: `ChouYu 验收 ${id}：清空测试`, importance: 0.6, confidence: 1, sensitivity: 'normal' })
    provider.createCandidate({ type: 'fact', content: `ChouYu 验收 ${id}：待确认清空测试`, importance: 0.6, confidence: 1, sensitivity: 'normal' })
    await provider.clearConfirmed()
    if ((await remote.list()).length || provider.list({ status: 'all' }).length) throw new Error('Confirmed clear left records behind')
    checks.push({ name: 'confirmed-clear', passed: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    failureDetail = sanitize(message)
    const category = /认证失败/.test(message) ? 'authentication' : /超时/.test(message) ? 'timeout' : /无法连接/.test(message) ? 'connection' : message.match(/API error (\d{3})/)?.[1] || 'assertion-or-protocol'
    checks.push({ name: `${stage}-failed-${category}`, passed: false })
  } finally {
    provider?.close()
    if (scopeVerified) {
      try {
        const remaining = await remote.list()
        for (const record of remaining) {
          if (!record.content.includes(id)) throw new Error('Unexpected record in cleanup scope')
          await remote.deleteRemote(record.id)
        }
        cleanupPassed = (await remote.list()).length === 0
      } catch (error) { cleanupPassed = false; cleanupError = sanitize(error instanceof Error ? error.message : 'unknown') }
    }
  }
  return { host: new URL(config.memorySyncBaseUrl).hostname, userId, testLocalId: id, scopeVerified, checks, failureDetail, cleanupError, cleanupPassed, passed: checks.every(check => check.passed) && cleanupPassed }

  function sanitize(value: string): string {
    for (const secret of [config.apiKey, config.memorySyncApiKey]) if (secret) value = value.split(secret).join('[redacted]')
    return value.replace(/https?:\/\/\S+/g, '[url]').slice(0, 250)
  }
  async function cleanupOnly() {
    const records = await remote.list()
    for (const record of records) {
      if (!record.content.includes(id)) throw new Error('Unexpected record in cleanup scope')
      await remote.deleteRemote(record.id)
    }
    const empty = (await remote.list()).length === 0
    return { host: new URL(config.memorySyncBaseUrl).hostname, userId, testLocalId: id, scopeVerified: true, checks: [{ name: 'cleanup-existing-test', passed: empty }], failureDetail: '', cleanupError: '', cleanupPassed: empty, passed: empty }
  }
}
