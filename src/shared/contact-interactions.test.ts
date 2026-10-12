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
it('distinguishes malformed plans, access restrictions and skill dependencies with the correct remedy', () => {
  expect(contactFailure('工作计划 urls 必须为数组')).toMatchObject({ kind: 'format', settings: false })
  expect(contactFailure('网页访问权限不足：计划地址不在允许访问的网页范围内。')).toMatchObject({ kind: 'permission', settingsTarget: 'work' })
  expect(contactFailure('未授权读取联系人的共享成果。')).toMatchObject({ kind: 'permission', settingsTarget: 'work' })
  expect(contactFailure('Docker 未启动，技能脚本无法运行')).toMatchObject({ kind: 'skill', settingsTarget: 'skills' })
  expect(contactFailure('研究计划包含当前权限不允许读取的网页。').message).not.toContain('模型服务的密钥')
})
it('roundtrips shared references and deduplicates cards without editing surrounding prose', () => {
  const href = interactionHref('owner', 'run:question:a&b')
  const result = interactionReferences(`需要你的回复。\n[处理](${href})\n[重复](${href})`)
  expect(result.refs).toEqual([{ characterId: 'owner', id: 'run:question:a&b' }])
  expect(result.content).toContain('需要你的回复。')
  expect(interactionReferences('[错误](#contact-interaction?id=missing-owner)').refs).toEqual([])
})
it('routes search service failures and disabled skill tools to their actual settings', () => {
  expect(contactFailure('搜索失败（HTTP 401），请检查密钥或额度。')).toMatchObject({ settingsTarget: 'work' })
  expect(contactFailure('搜索失败（HTTP 429），请检查密钥或额度。').message).toContain('请求受限')
  expect(contactFailure('搜索失败（HTTP 503），请检查密钥或额度。').message).toContain('暂时不可用')
  expect(contactFailure('技能工具已被用户禁用')).toMatchObject({ kind: 'permission', settings: true })
  expect(contactFailure('技能工具已被用户禁用').settingsTarget).toBeUndefined()
})
