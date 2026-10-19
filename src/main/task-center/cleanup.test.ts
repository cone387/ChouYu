import { expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ContactTaskStore } from './contact-store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'

for (const operation of ['task', 'contact'] as const) it(`preserves ${operation} execution cleanup intent across database reopening`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-cleanup-outbox-')), file = join(dir, 'agents.db')
  let store = new ContactTaskStore(file)
  try {
    store.ensure('alice'); store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: 'Fixture', sources: ['https://example.com/'] })
    const runId = store.createRun('alice', ''), run = store.getRun(runId)!
    if (operation === 'task') {
      const topic = store.topics.get('alice', run.topic_id!)
      store.deleteTopic('alice', topic.id, topic.revision)
    } else store.remove('alice')
    expect(store.getRun(runId)).toBeUndefined()
    expect(store.pendingCleanup()).toEqual([{ characterId: 'alice', requestId: runId }])
    store.close(); store = new ContactTaskStore(file)
    expect(store.pendingCleanup()).toEqual([{ characterId: 'alice', requestId: runId }])
    store.finishCleanup('alice', runId)
    expect(store.pendingCleanup()).toEqual([])
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
})

for (const kind of ['memories', 'materials'] as const) it(`queues log cleanup for both completed and active work after ${kind} withdrawal`, () => {
  const store = new ContactTaskStore(':memory:')
  try {
    store.ensure('alice'); store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: 'Fixture', sources: ['https://example.com/'] })
    const run = store.createRun('alice', '')
    store.db.prepare("UPDATE runs SET input=json_set(input,'$.contextReferences',json(?)), status='completed' WHERE id=?").run(JSON.stringify({ [kind]: [{ id: 'withdrawn' }] }), run)
    const active = store.createRun('alice', '')
    store.db.prepare("UPDATE runs SET input=json_set(input,'$.contextReferences',json(?)) WHERE id=?").run(JSON.stringify({ [kind]: [{ id: 'withdrawn' }] }), active)
    if (kind === 'memories') store.invalidateMemory('alice', 'withdrawn')
    else store.invalidateMaterial('alice', 'withdrawn')
    expect(store.getRun(run)!.status).toBe('completed')
    expect(store.getRun(active)!.status).toBe('cancelled')
    expect(store.pendingCleanup().map(item => item.requestId).sort()).toEqual([run, active].sort())
  } finally { store.close() }
})
