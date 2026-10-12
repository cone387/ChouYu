import { expect, it, vi } from 'vitest'
import { ReadingSaveQueue } from './readingSaveQueue'
import type { ReadingPosition } from '../../../../shared/contact-content'
const position = (n: number): ReadingPosition => ({ ref: { characterId: 'alice', topicId: 'task', version: 1 }, scrollRatio: n / 10, updatedAt: n })
it('serializes close flush after a failed earlier write without losing the latest reading position', async () => {
  let reject!: (e: Error) => void
  const save = vi.fn().mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail })).mockResolvedValue(undefined)
  const error = vi.fn(), queue = new ReadingSaveQueue(save, () => {}, error)
  queue.record(position(1)); const first = queue.flush()
  queue.record(position(2)); const closing = queue.flush()
  reject(Error('disk failure')); await Promise.all([first, closing])
  expect(save.mock.calls.map(call => call[0])).toEqual([position(1), position(2)])
  expect(error).not.toHaveBeenCalled()
  await queue.flush(); expect(save).toHaveBeenCalledTimes(2)
})
it('keeps the latest failed position for an explicit retry', async () => {
  const save = vi.fn().mockRejectedValueOnce(Error('disk')).mockResolvedValue(undefined)
  const error = vi.fn(), queue = new ReadingSaveQueue(save, () => {}, error)
  queue.record(position(3)); await queue.flush(); expect(error).toHaveBeenCalledOnce()
  await queue.flush(); expect(save.mock.calls.map(call => call[0])).toEqual([position(3), position(3)])
})
