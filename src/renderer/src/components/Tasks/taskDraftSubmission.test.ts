import { expect, it, vi } from 'vitest'
import { saveTaskDraft, emptyDraft } from './taskDraftSubmission'

it('keeps the exact draft available after a storage rejection and retries the same task', async () => {
  const draft = { ...emptyDraft, id: 'existing', title: '保留正文', note: '尚未保存', projectId: 'inbox' }
  const snapshot = structuredClone(draft)
  const api = { create: vi.fn(), update: vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue({ id: 'existing' }) }
  await expect(saveTaskDraft(draft, [], api)).rejects.toThrow('disk full')
  expect(draft).toEqual(snapshot)
  await expect(saveTaskDraft(draft, [], api)).resolves.toEqual({ id: 'existing' })
  expect(api.update).toHaveBeenCalledTimes(2)
  expect(api.update.mock.calls[1]).toEqual(api.update.mock.calls[0])
  expect(api.create).not.toHaveBeenCalled()
})

it('rejects invalid fields before a command and keeps original minute precision for unchanged dates', async () => {
  const api = { create: vi.fn(), update: vi.fn().mockResolvedValue({ id: 'existing' }) }
  await expect(saveTaskDraft(emptyDraft, [], api)).rejects.toThrow('标题')
  await expect(saveTaskDraft({ ...emptyDraft, title: '工作' }, [], api)).rejects.toThrow('清单')
  expect(api.create).not.toHaveBeenCalled()
  const start = new Date(2026, 9, 22, 9, 0, 30).getTime()
  await saveTaskDraft({ ...emptyDraft, id: 'existing', title: '工作', projectId: 'inbox', startDate: '2026-10-22', originalStartAt: start }, [], api)
  expect(api.update.mock.calls[0][1].startAt).toBe(start)
})
