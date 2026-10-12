import { afterEach, expect, it, vi } from 'vitest'
import { ReturnLocations, validateReturnLocation } from './contactReturnLocation'
import { DEFAULT_CHARACTER_ID } from '../../../../shared/characters'
afterEach(() => vi.unstubAllGlobals())
it('keeps exact source versions and task context, consumes once and cannot cross windows', () => {
  const one = new ReturnLocations(), two = new ReturnLocations()
  const location = { characterId: 'alice', tab: 'portfolio' as const, topicId: 'story', interactionId: 'pending', scrollTop: 432, delivery: { ref: { characterId: 'alice', topicId: 'story', version: 1, sectionId: 'text' } } }
  const token = one.save(location)
  location.delivery.ref.version = 2
  expect(two.take(token)).toBeUndefined()
  expect(one.take(token)).toMatchObject({ ...location, delivery: { ref: { ...location.delivery.ref, version: 1 } } })
  expect(one.take(token)).toBeUndefined()
})
it('validates original owner, exact version and unresolved interaction without mutation', async () => {
  const validateCitation = vi.fn(), getInteraction = vi.fn()
  vi.stubGlobal('window', { electronAPI: { characters: { list: async () => [{ id: 'alice' }] }, agents: { validateCitation, getInteraction } } })
  const delivery = { ref: { characterId: 'alice', topicId: 'story', version: 1 } }
  await validateReturnLocation({ characterId: 'alice', tab: 'portfolio', scrollTop: 0, delivery, interactionId: 'question' })
  expect(validateCitation).toHaveBeenCalledWith('alice', delivery)
  expect(getInteraction).toHaveBeenCalledWith('alice', 'question')
  await expect(validateReturnLocation({ characterId: 'deleted', tab: 'work', scrollTop: 0 })).rejects.toThrow('已删除')
})
it('refuses removed schedules rather than restoring a different assistant task', async () => {
  vi.stubGlobal('window', { electronAPI: { characters: { list: async () => [{ id: DEFAULT_CHARACTER_ID }] }, assistantRoutines: { list: async () => [] } } })
  await expect(validateReturnLocation({ characterId: DEFAULT_CHARACTER_ID, tab: 'work', topicId: 'routine:deleted', scrollTop: 0 })).rejects.toThrow('删除')
  await expect(validateReturnLocation({ characterId: DEFAULT_CHARACTER_ID, tab: 'work', topicId: 'duty:unknown', scrollTop: 0 })).rejects.toThrow('不存在')
})
it('bounds each window to twenty snapshots and rejects invalid or cross-owner sources', () => {
  const locations = new ReturnLocations(), tokens: string[] = []
  for (let n = 0; n < 21; n++) tokens.push(locations.save({ characterId: 'alice', tab: 'work', topicId: `task-${n}`, scrollTop: n }))
  expect(locations.take(tokens[0])).toBeUndefined()
  expect(locations.take(tokens[1])?.topicId).toBe('task-1')
  expect(() => locations.save({ characterId: 'alice', tab: 'work', scrollTop: Infinity })).toThrow()
  expect(() => locations.save({ characterId: 'alice', tab: 'portfolio', scrollTop: 0, delivery: { ref: { characterId: 'bob', topicId: 'story', version: 1 } } })).toThrow()
})
