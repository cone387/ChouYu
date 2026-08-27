import { describe, expect, it } from 'vitest'
import {
  VISUAL_ACTION_PROMPTS,
  filterCaptureSources,
  getCaptureSourceKind,
  isValidCaptureSourceId
} from './capture'

describe('desktop capture helpers', () => {
  it('classifies and validates Electron capture source ids', () => {
    expect(getCaptureSourceKind('screen:1:0')).toBe('screen')
    expect(getCaptureSourceKind('window:42:0')).toBe('window')
    expect(isValidCaptureSourceId('window:42:0')).toBe(true)
    expect(isValidCaptureSourceId('file:///secret')).toBe(false)
  })

  it('filters the ChouYu window without hiding unrelated windows', () => {
    const sources = [{ name: 'ChouYu' }, { name: 'ChouYu - DevTools' }, { name: 'Visual Studio Code' }]
    expect(filterCaptureSources(sources, 'ChouYu')).toEqual([{ name: 'Visual Studio Code' }])
  })

  it('defines prompts for each visual quick action', () => {
    expect(VISUAL_ACTION_PROMPTS.ocr).toContain('识别')
    expect(VISUAL_ACTION_PROMPTS.summarize).toContain('概括')
    expect(VISUAL_ACTION_PROMPTS.translate).toContain('翻译')
  })
})
