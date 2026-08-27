import { describe, expect, it } from 'vitest'
import { getToolRiskLabel, parseToolArguments, validateToolArguments } from './tools'

describe('tool protocol helpers', () => {
  it('parses object arguments and rejects non-object JSON', () => {
    expect(parseToolArguments('{"text":"hello"}')).toEqual({ text: 'hello' })
    expect(parseToolArguments('[1,2]')).toEqual({})
    expect(parseToolArguments('broken')).toEqual({})
  })

  it('provides a user-facing risk label', () => {
    expect(getToolRiskLabel('safe')).toContain('无副作用')
    expect(getToolRiskLabel('read')).toContain('读取')
    expect(getToolRiskLabel('write')).toContain('修改')
  })

  it('validates required arguments and strips unknown fields', () => {
    const schema = {
      type: 'object' as const,
      properties: { text: { type: 'string' as const, maxLength: 5 } },
      required: ['text'],
      additionalProperties: false
    }
    expect(validateToolArguments(schema, { text: '1234567', hidden: true })).toEqual({ text: '12345' })
    expect(() => validateToolArguments(schema, {})).toThrow('text')
  })
})
