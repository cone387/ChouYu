import { expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WorkLoopHost } from './workloop-host'
import { ContactTaskStore } from '../task-center/contact-store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'

it.each(['withdrawMaterial', 'forgetMemory', 'updateMemory'] as const)('rolls back %s if durable cleanup intent cannot commit', async method => {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-context-cleanup-'))
  const host = new WorkLoopHost(dir, () => {}, undefined, undefined, undefined, undefined, undefined, { modules: [] })
  let reopened: ContactTaskStore | undefined
  try {
    await host.sync([{ id: 'alice', soul: '', conversation: '', config: null }])
    host.store.save('alice', { ...DEFAULT_AGENT_SETTINGS, enabled: false, goal: 'Fixture', sources: ['https://example.com/'] })
    const material = method === 'withdrawMaterial'
    const memoryInput = { content: 'original', kind: 'preference' as const, scope: { kind: 'contact' as const }, source: { kind: 'user' as const, at: 1 } }
    const reference = material ? host.store.materials.save('alice', { name: 'source', content: 'original', scope: { kind: 'contact' }, source: { kind: 'text', label: 'fixture' } })
      : host.store.memoryLibrary.create('alice', memoryInput)
    const run = host.store.createRun('alice', '')
    host.store.db.prepare("UPDATE runs SET input=json_set(input,'$.contextReferences',json(?)),status='waiting' WHERE id=?").run(JSON.stringify({ [material ? 'materials' : 'memories']: [{ id: reference.id }] }), run)
    host.store.db.exec("CREATE TRIGGER cleanup_fault BEFORE INSERT ON execution_cleanup BEGIN SELECT RAISE(ABORT,'fixture cleanup write failed'); END")
    const operation = method === 'updateMemory'
      ? host.request(method, 'alice', [reference.id, 1, { ...memoryInput, content: 'corrected' }])
      : host.request(method, 'alice', [reference.id, 1])
    await expect(operation).rejects.toThrow('fixture cleanup write failed')
    await host.close()
    reopened = new ContactTaskStore(join(dir, 'agents.db'))
    if (material) expect(reopened.materials.list({ characterId: 'alice', query: '' }).map(item => item.id)).toContain(reference.id)
    else expect(reopened.memoryLibrary.select({ characterId: 'alice', query: '' }).items).toEqual([expect.objectContaining({ id: reference.id, content: 'original', revision: 1 })])
    expect(reopened.getRun(run)!.status).toBe('waiting')
    expect(reopened.pendingCleanup()).toEqual([])
  } finally { reopened?.close(); await host.close(); rmSync(dir, { recursive: true, force: true }) }
})
