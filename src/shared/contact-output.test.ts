import { expect, it } from 'vitest'
import { outputKinds, resolveContactOutput, sanitizeContactOutput, validateOutputPreference } from './contact-output'
import { validateDeliveryUpdate } from './agent-delivery'

it.each(['writing', 'ideas', 'review', 'research', 'plan', 'briefing', 'plain'])('preserves the complete saved body for %s while validating its presentation', kind => {
  const body = '# 正文\n\n' + '保留全文，不得截断。\n'.repeat(500)
  const update = validateDeliveryUpdate({ completionCriteria: '完成', stages: [{ id: 'one', title: '阶段', status: 'done' }], summary: '完成', section: { id: 'one', title: '标题', body, output: { kind, density: 'comfortable' } } })
  expect(update.section?.body).toBe(body.trim())
  expect(update.section?.output).toEqual({ kind, density: 'comfortable' })
})
it('falls back to full ordinary prose for unknown or unsafe model descriptions without losing the delivery', () => {
  for (const raw of [{ kind: 'invented' }, { kind: 'review', script: 'alert(1)' }, { kind: 'review', density: 'invisible' }]) {
    expect(sanitizeContactOutput(raw)).toBeUndefined()
    expect(resolveContactOutput(raw)).toEqual({ kind: 'plain', density: 'comfortable' })
    const update = validateDeliveryUpdate({ completionCriteria: '完成', stages: [{ id: 'one', title: '阶段', status: 'done' }], summary: '完成', section: { id: 'one', title: '标题', body: '完整正文', output: raw } })
    expect(update.section?.body).toBe('完整正文')
    expect(update.section?.output).toBeUndefined()
  }
})
it('applies explicit delivery, task and contact preferences in order without leaking a one-version choice', () => {
  const model = { kind: 'ideas', density: 'comfortable' }
  const contact = { kind: 'review', density: 'compact' }, task = { density: 'comfortable' }, once = { kind: 'plain' }
  expect(resolveContactOutput(model, [contact, task, once])).toEqual({ kind: 'plain', density: 'comfortable' })
  expect(resolveContactOutput(model, [contact, task])).toEqual({ kind: 'review', density: 'comfortable' })
  expect(resolveContactOutput(model, [contact, { kind: 'auto' }])).toEqual({ kind: 'ideas', density: 'compact' })
})
it('validates explicit preferences strictly and never accepts actions, code or content replacements', () => {
  expect(outputKinds).toHaveLength(7)
  expect(validateOutputPreference({ density: 'compact', instruction: '先结论再依据' })).toEqual({ density: 'compact', instruction: '先结论再依据' })
  for (const raw of [{ kind: 'unknown' }, { actions: ['delete'] }, { body: '换掉正文' }, { script: 'code' }, { instruction: 'x'.repeat(2001) }]) expect(() => validateOutputPreference(raw)).toThrow()
})
