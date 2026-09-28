import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentService } from './service'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn() })
it('deletes an executing task, aborts its model and clears checkpoints without affecting another task', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-delete-'))
  let signal: AbortSignal | undefined
  const service = new AgentService(dir, () => {}, () => async (_prompt, value) => {
    signal = value
    return new Promise<string>((_resolve, reject) => value.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
  })
  cleanup.push(async () => { await service.close(); rmSync(dir, { recursive: true, force: true }) })
  await service.sync([{ id: 'alice', soul: '', conversation: '', config: { provider: 'openai', baseUrl: 'https://example.com', apiKey: 'test', model: 'test', thinkingDisabledModels: [] } }])
  const first = service.store.createTopic('alice', { title: '保留', goal: '保留目标', constraints: '' }).topics[0]
  await service.request('assignTopic', 'alice', ['需要删除的任务'])
  await vi.waitFor(() => expect(signal).toBeDefined())
  const data = service.store.overview('alice'), target = data.topics.find(t => t.id !== first.id)!
  const runId = data.runs[0].id
  const deleted = vi.spyOn(service.runtime.checkpoints, 'deleteThread')
  expect(() => service.store.deleteTopic('other', target.id, target.revision)).toThrow()
  expect(() => service.store.deleteTopic('alice', target.id, target.revision + 1)).toThrow()
  expect(signal!.aborted).toBe(false)
  const result = await service.request('deleteTopic', 'alice', [target.id, target.revision])
  expect(signal!.aborted).toBe(true)
  expect(result.topics.map((t: { id: string }) => t.id)).toEqual([first.id])
  expect(result.runs).toHaveLength(0)
  expect(result.focusTopicId).toBeNull()
  expect(deleted).toHaveBeenCalledWith(runId)
  expect(service.store.db.prepare('SELECT count(*) AS n FROM topic_changes WHERE topic_id=?').get(target.id)).toEqual({ n: 0 })
  service.tick()
  expect(service.store.overview('alice').runs).toHaveLength(0)
})
