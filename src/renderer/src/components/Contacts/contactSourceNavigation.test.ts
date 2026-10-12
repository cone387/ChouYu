import { expect, it } from 'vitest'
import { parseDeliverySource, receiptDeliveryRef } from '../../../../shared/contact-source-navigation'
import { readMaterialPassage } from './materialReading'
it('opens immutable receipt and review sources at their exact owner/version/section', () => {
  const ref = { characterId: 'Alice', topicId: 'task', version: 2, sectionId: 'body' }
  expect(parseDeliverySource('contact-delivery://Alice/task/body?version=2')).toEqual(ref)
  expect(parseDeliverySource('contact-delivery://Alice/task/body?version=0')).toBeNull()
  expect(receiptDeliveryRef({ version: 1, characterId: 'Alice', intent: 'delivery', source: { kind: 'task', topicId: 'task', runId: 'run', artifact: { version: 2, sectionId: 'body' } } })).toEqual(ref)
  expect(receiptDeliveryRef(undefined)).toBeNull()
})
it('loads exactly the cited later UTF16 passage, while whole-document reads start at zero', async () => {
  const body = 'a'.repeat(12000) + '😀end', ref = { id: 'doc', version: 1, start: 12000, end: 12002 }
  const offsets: number[] = []
  const read = async (offset: number) => { offsets.push(offset); return { text: body.slice(offset, offset + 12000), ref, ...(offset + 12000 < body.length ? { nextOffset: offset + 12000 } : {}) } }
  expect(await readMaterialPassage(ref, read)).toEqual({ text: '😀', ref })
  expect(offsets).toEqual([12000])
  await readMaterialPassage({ id: 'doc', version: 1 }, read); expect(offsets.at(-1)).toBe(0)
})
