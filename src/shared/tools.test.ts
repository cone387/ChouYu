import { describe, expect, it } from 'vitest'
import { getToolRiskLabel, parseToolArguments, shouldConfirmTool, validateToolArguments } from './tools'

describe('tool protocol helpers', () => {
  it('respects confirm, auto-review, and full-access permission modes', () => {
    const readTool = { risk: 'read' as const, requiresConfirmation: true }
    const writeTool = { risk: 'write' as const, requiresConfirmation: true }
    const safeTool = { risk: 'safe' as const, requiresConfirmation: false }

    expect(shouldConfirmTool(readTool, 'confirm')).toBe(true)
    expect(shouldConfirmTool(readTool, 'auto')).toBe(false)
    expect(shouldConfirmTool(writeTool, 'auto')).toBe(true)
    expect(shouldConfirmTool(writeTool, 'full')).toBe(false)
    expect(shouldConfirmTool(safeTool, 'confirm')).toBe(false)
  })

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
