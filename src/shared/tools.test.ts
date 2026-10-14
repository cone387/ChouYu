import { describe, expect, it } from 'vitest'
import { getToolRiskLabel, parseToolArguments, shouldConfirmTool, validateToolArguments } from './tools'

describe('tool protocol helpers', () => {
  it('validates bounded string arrays without truncating URLs or retaining caller-owned arrays', () => {
    const schema = { type: 'object' as const, properties: { sources: { type: 'array' as const, items: { type: 'string' as const, maxLength: 30 }, maxItems: 5 } }, additionalProperties: false }
    const sources = ['https://example.com/']
    const saved = validateToolArguments(schema, { sources })
    sources.push('https://other.example/')
    expect(saved.sources).toEqual(['https://example.com/'])
    for (const value of ['https://example.com', [1], [null], [['nested']], Array(6).fill('url'), ['x'.repeat(31)]]) expect(() => validateToolArguments(schema, { sources: value })).toThrow('sources')
  })
  it('uses an explicit contact policy without weakening inherited forced confirmation', () => {
    const forced = { risk: 'write' as const, requiresConfirmation: true, alwaysConfirm: true }
    expect(shouldConfirmTool(forced, 'full', 'inherit')).toBe(true)
    expect(shouldConfirmTool(forced, 'confirm', 'full')).toBe(false)
    expect(shouldConfirmTool(forced, 'full', 'confirm')).toBe(true)
    expect(shouldConfirmTool(forced, 'full', 'auto')).toBe(true)
    expect(shouldConfirmTool({ ...forced, risk: 'read' }, 'confirm', 'auto')).toBe(false)
  })
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
