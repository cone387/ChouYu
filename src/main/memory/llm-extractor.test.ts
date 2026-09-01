import { describe, expect, it, vi } from 'vitest'
import { extractMemoriesWithLLM } from './llm-extractor'
import type { AppConfig } from '../../shared/config'

const config = {
  provider: 'openai', baseUrl: 'https://provider.example/v1', apiKey: 'test-key', model: 'test-model'
} as AppConfig

describe('LLM memory extraction', () => {
  it('accepts structured self memory and rejects model guesses', async () => {
    const request = vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ memories: [
      { action: 'remember', subject: 'self', certainty: 'explicit', type: 'person', content: '我的名字是 小鱼', confidence: 0.96, importance: 0.9 },
      { action: 'remember', subject: 'other', certainty: 'explicit', type: 'person', content: '我的朋友叫小明', confidence: 0.99, importance: 0.8 }
    ] }) } }] })) as typeof fetch
    const result = await extractMemoriesWithLLM('我叫小鱼', config, request)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ type: 'person', content: '我的名字是 小鱼', certainty: 'explicit', subject: 'self' })
    expect(request).toHaveBeenCalledWith('https://provider.example/v1/chat/completions', expect.objectContaining({ method: 'POST' }))
  })

  it('keeps uncertain statements out of automatic-write confidence', async () => {
    const request = vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ memories: [
      { action: 'remember', subject: 'self', certainty: 'uncertain', type: 'person', content: '我的名字是 可能吧', confidence: 0.99, importance: 0.9 }
    ] }) } }] })) as typeof fetch
    const result = await extractMemoriesWithLLM('我可能叫可能吧', config, request)
    expect(result[0].confidence).toBeLessThan(0.8)
  })

  it('supports Claude response envelopes', async () => {
    const request = vi.fn(async () => Response.json({ content: [{ type: 'text', text: '{"memories":[]}' }] })) as typeof fetch
    const result = await extractMemoriesWithLLM('随便聊聊', { ...config, provider: 'claude' }, request)
    expect(result).toEqual([])
    expect(request).toHaveBeenCalledWith('https://provider.example/v1/messages', expect.objectContaining({ method: 'POST' }))
  })
})
