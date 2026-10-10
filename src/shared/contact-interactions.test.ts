import { expect, it } from 'vitest'
import { contactFailure } from './contact-failure'
import { interactionHref, interactionReferences } from './contact-interactions'
it('distinguishes billing from transient 429 and leaves format errors actionable', () => {
  expect(contactFailure('API error 429: 余额不足或无可用资源包')).toMatchObject({ kind: 'billing', settings: true })
  expect(contactFailure('API error 429: rate limit')).toMatchObject({ kind: 'network', settings: false })
  expect(contactFailure('API error 401')).toMatchObject({ kind: 'configuration', settings: true })
  expect(contactFailure('成果字段 nextStep 校验失败')).toMatchObject({ kind: 'format', settings: false })
  expect(contactFailure('some unexpected error')).toMatchObject({ kind: 'unknown' })
})
it('roundtrips shared references and deduplicates cards without editing surrounding prose', () => {
  const href = interactionHref('owner', 'run:question:a&b')
  const result = interactionReferences(`需要你的回复。\n[处理](${href})\n[重复](${href})`)
  expect(result.refs).toEqual([{ characterId: 'owner', id: 'run:question:a&b' }])
  expect(result.content).toContain('需要你的回复。')
  expect(interactionReferences('[错误](#contact-interaction?id=missing-owner)').refs).toEqual([])
})
