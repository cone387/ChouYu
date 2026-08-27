import { describe, expect, it } from 'vitest'
import { filterModels } from './ModelPicker'

describe('model picker filtering', () => {
  const models = ['gemini-2.5-flash', 'deepseek-chat', 'Gemini-3.7-Flash']

  it('shows every model when the search is empty', () => {
    expect(filterModels(models, '')).toEqual(models)
  })

  it('filters model names case-insensitively', () => {
    expect(filterModels(models, 'GEMINI')).toEqual(['gemini-2.5-flash', 'Gemini-3.7-Flash'])
  })

  it('ignores surrounding search whitespace', () => {
    expect(filterModels(models, ' chat ')).toEqual(['deepseek-chat'])
  })
})
