import { expect, it } from 'vitest'
import { decodeMaterialFile, loadMaterialImport } from './material-import'
import { createMaterialTools } from './material-tools'
import type { ToolExecutionContext } from '../tools/registry'
it('rejects binary/invalid UTF8 files and does not broaden web access', async () => {
  expect(decodeMaterialFile('notes.md', Buffer.from('正文'))).toBe('正文')
  for (const [name, data] of [['a.pdf', Buffer.from('PDF')], ['a.md', Buffer.from([255, 254])], ['a.txt', Buffer.from('a\0b')]] as const) expect(() => decodeMaterialFile(name, data)).toThrow()
  let reads = 0
  const source = { kind: 'web' as const, label: 'web', url: 'https://example.com/new' }
  const input = { name: '网页', scope: { kind: 'contact' as const }, source }
  const deps = { chooseFile: async () => null, readWeb: async () => { reads++; return 'web content' }, allowed: async () => false }
  await expect(loadMaterialImport(input, deps, new AbortController().signal)).rejects.toThrow()
  expect(reads).toBe(0)
  const controller = new AbortController()
  await expect(loadMaterialImport(input, { ...deps, allowed: async () => true, readWeb: async () => { controller.abort(); return 'late' } }, controller.signal)).rejects.toThrow()
})
it('lists metadata without pretending to read text and returns bounded actual reads', async () => {
  const reads: unknown[] = []
  const tools = createMaterialTools({ owner: () => 'alice', dispatchUnknown: async (method, _owner, args) => {
    if (method === 'materialList') return [{ id: 'doc', version: 2, name: 'Guide' }]
    reads.push(args); return { text: 'actual passage', ref: { id: 'doc', version: 2 }, nextOffset: 12000 }
  } })
  const context = { sessionId: 'chat', mainWindow: {} } as ToolExecutionContext
  const listed = await tools[0].execute({}, context)
  expect(listed.content).not.toContain('actual passage'); expect(reads).toHaveLength(0)
  const result = JSON.parse((await tools[1].execute({ id: 'doc', version: 2, offset: 20, topicId: 'task' }, context)).content)
  expect(result.text).toBe('actual passage'); expect(result.materialRead).toMatchObject({ id: 'doc', version: 2, start: 20, end: 34, topicId: 'task' })
})
