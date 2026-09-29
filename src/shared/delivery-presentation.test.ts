import { describe, expect, it } from 'vitest'
import { validateDeliveryUpdate, validateTaskInputs, type AgentDelivery } from './agent-delivery'
import { deliveryDocument, deliveryHtmlExport } from './delivery-presentation'

const artifact: AgentDelivery = { version: 1, runId: 'run', createdAt: 1, completionCriteria: '完成正文', stages: [{ id: 'draft', title: '初稿', status: 'active' }], summary: '已写开篇', sections: [{ id: 'one', title: '开篇', body: '</script><script>parent.attack()</script>', runId: 'run' }], presentation: { title: '阅读', html: '<div id="content"></div>', css: '.body{line-height:2}', script: 'document.body.dataset.ready="yes"' } }
describe('custom delivery contracts', () => {
  it('keeps prose and code out of the bootstrap markup, with network and host access disabled', () => {
    const html = deliveryDocument('书名 <img>', artifact, 'test-nonce')
    expect(html).not.toContain(artifact.sections[0].body)
    expect(html).toContain('\\u003c/script>')
    expect(html).toContain("connect-src 'none'")
    expect(html).toContain("frame-src 'none'")
    expect(html).toContain('body.textContent=section.body')
    expect(deliveryHtmlExport('书', artifact, 'test-nonce')).toContain('sandbox="allow-scripts"')
    expect(() => deliveryDocument('书', artifact, 'bad"nonce')).toThrow()
  })
  it('validates custom fields and rejects duplicate IDs or executable field values', () => {
    const field = { id: 'reader', label: '读者', value: '', required: true, options: ['成人'] }
    expect(validateTaskInputs([field])).toEqual([field])
    expect(() => validateTaskInputs([field, field])).toThrow('重复')
    expect(() => validateTaskInputs([{ ...field, value: {} }])).toThrow()
    expect(() => validateTaskInputs([{ ...field, required: 'true' }])).toThrow()
  })
  it('accepts legacy prose, style-only revisions and explicit removal, rejecting invalid code', () => {
    const base = { completionCriteria: artifact.completionCriteria, stages: artifact.stages, summary: artifact.summary }
    expect(validateDeliveryUpdate({ ...base, section: artifact.sections[0] }).presentation).toBeUndefined()
    expect(validateDeliveryUpdate({ ...base, presentation: artifact.presentation }).section).toBeUndefined()
    expect(validateDeliveryUpdate({ ...base, presentation: null }).presentation).toBeNull()
    expect(() => validateDeliveryUpdate(base)).toThrow()
    expect(() => validateDeliveryUpdate({ ...base, presentation: { ...artifact.presentation, script: 'x'.repeat(16001) } })).toThrow()
  })
})
