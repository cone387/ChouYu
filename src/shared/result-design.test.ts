import { expect, it } from 'vitest'
import { validateDesignCode, sourceSnapshot, validateTaskRef } from './result-design'

it('validates bounded executable code separately from source content', () => {
  expect(() => validateDesignCode({ title: 'x', html: 'x'.repeat(12001), css: '', script: '' })).toThrow()
  expect(() => validateDesignCode({ title: 'x', html: '', css: '', script: '', source: 'forged' })).toThrow()
  expect(validateDesignCode({ title: ' 页面 ', html: '<div id="content"></div>', css: '', script: '' }).title).toBe('页面')
})
it('binds hashes to exact complete source data and rejects arbitrary task domains', () => {
  const task = { domain: 'contact' as const, ownerId: 'a', taskId: 'b' }
  const a = sourceSnapshot(task, '1', 'x', [{ id: 's', title: 't', body: '正文', sources: [] }], [])
  const b = sourceSnapshot(task, '1', 'x', [{ id: 's', title: 't', body: '另一段', sources: [] }], [])
  expect(a.ref.contentHash).not.toBe(b.ref.contentHash)
  expect(() => validateTaskRef({ ...task, domain: 'filesystem' })).toThrow()
})
