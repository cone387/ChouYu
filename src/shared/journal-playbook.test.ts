import { describe, expect, it } from 'vitest'
import { playbookMarkdown, validateJournalPlaybook, type JournalPlaybookInput } from './journal-playbook'
const id = '11111111-2222-3333-4444-555555555555'
const input: JournalPlaybookInput = { title: '接口排查', problem: '请求超时', attempts: '', resolution: '', status: 'open', projectId: null, sourceIds: [id] }
describe('personal troubleshooting records', () => {
  it('does not treat a recorded problem as solved without an explicit solution', () => {
    expect(validateJournalPlaybook(input).status).toBe('open')
    expect(() => validateJournalPlaybook({ ...input, status: 'resolved' })).toThrow('解决办法')
    expect(validateJournalPlaybook({ ...input, status: 'resolved', resolution: '释放连接后恢复' }).status).toBe('resolved')
  })
  it('bounds content and checks source identities and edit versions', () => {
    for (const patch of [{ sourceIds: [id, id] }, { sourceIds: ['missing'] }, { id }, { revision: 1 }, { attempts: 'x'.repeat(8001) }, { projectId: 'invalid' }]) {
      expect(() => validateJournalPlaybook({ ...input, ...patch })).toThrow()
    }
  })
  it('exports manual status and explicitly labels unavailable evidence', () => {
    const text = playbookMarkdown({ ...input, id, revision: 1, createdAt: 1, updatedAt: 1, missingSourceIds: [id] })
    expect(text).toContain('状态：待解决')
    expect(text).toContain('尚未确认')
    expect(text).toContain('已删除，无法回看')
    expect(text).not.toContain('已解决')
  })
})
