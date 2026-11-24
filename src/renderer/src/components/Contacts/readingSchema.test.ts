import { expect, it, vi } from 'vitest'
import { z } from 'zod'
import { readingSchema } from './readingSchema'

it('keeps Zod 4 constraints and rejects oversized collections before parsing every item', () => {
  const check = vi.fn(() => true)
  const schema = readingSchema(z.object({ children: z.array(z.string().refine(check)).max(300),
    sectionIndex: z.number().int().min(0).max(299), treatment: z.enum(['body', 'emphasis']) }))
  const result = schema.safeParse({ children: Array(10_000).fill('child'), sectionIndex: 0, treatment: 'body' })
  expect(result.success).toBe(false)
  expect(check).not.toHaveBeenCalled()
  expect(schema.safeParse({ children: ['child'], sectionIndex: 300, treatment: 'body' }).success).toBe(false)
  expect(schema.safeParse({ children: ['child'], sectionIndex: 0, treatment: 'invalid' }).success).toBe(false)
  expect(schema.parse({ children: ['child'], sectionIndex: 0, treatment: 'body' })).toEqual({ children: ['child'], sectionIndex: 0, treatment: 'body' })
})

it('fails closed if a future catalog adds an unsupported schema kind', () => {
  expect(() => readingSchema(z.record(z.string(), z.string()))).toThrow('Unsupported reading schema type')
})
