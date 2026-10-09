import { expect, it } from 'vitest'
import { legacyProgressUpdate, progressText } from './agent-progress'
import { sanitizeAgentMessageRef } from './agents'

it('displays the old template without treating its next step as completed work', () => {
  const content = '「持续生产idea」有新的判断。\n\n当前判断：本轮交付idea #23 部署回滚决策助手\n\n变化原因：继续探索运维方向\n\n下一步：产出第24个idea'
  expect(legacyProgressUpdate(content)).toEqual({ taskTitle: '持续生产idea', title: '', summary: '本轮交付idea #23 部署回滚决策助手', nextStep: '产出第24个idea', outcome: 'updated' })
  expect(legacyProgressUpdate('额度不足，请调整上限。')).toBeUndefined()
})

it('preserves validated structured updates through message persistence and rejects invalid data', () => {
  const update = { taskTitle: '持续生产idea', title: '部署回滚决策助手', summary: '已保存第23个idea', nextStep: '继续第24个', outcome: 'delivered' as const }
  expect(sanitizeAgentMessageRef({ topicId: 'task', runId: 'run', kind: 'progress', update })?.update).toEqual(update)
  expect(sanitizeAgentMessageRef({ topicId: 'task', runId: 'run', kind: 'progress', update: { ...update, outcome: 'running' } })?.update).toBeUndefined()
  expect(progressText(update)).not.toMatch(/当前判断|变化原因|有新的判断/)
  expect(progressText(update)).toContain('本轮成果已保存：部署回滚决策助手')
})
