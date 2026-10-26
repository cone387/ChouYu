import { describe, expect, it, vi } from 'vitest'
import type { AIStreamRequest } from '../../../shared/ai'
import { DEFAULT_APP_CONFIG } from '../../../shared/config'
import type { Message } from '../shared/types'
import { joinApiUrl, parseClaudeStreamLine, parseOpenAIStreamLine, streamChat } from './ai-engine'

describe('AI stream parsers', () => {
  it.each(['events-first', 'result-first'])('keeps the completion barrier scoped to its request (%s)', async order => {
    let listener: (event: any) => void = () => {}, requestId = '', release!: () => void, settled = false, rendered = ''
    vi.stubGlobal('window', { electronAPI: { ai: {
      onStreamEvent: (callback: typeof listener) => { listener = callback; return () => {} }, cancelStream: vi.fn(),
      startStream: (request: AIStreamRequest) => { requestId = request.requestId; return new Promise(resolve => { release = () => resolve({ ok: true, waitForStreamEnd: true }) }) }
    } } })
    const running = streamChat([], '', { ...DEFAULT_APP_CONFIG, apiKey: 'k', model: 'm' }, (text, done) => { if (!done) rendered += text }).then(() => { settled = true })
    try {
      listener({ requestId: 'another-request', chunk: 'foreign', done: true })
      if (order === 'result-first') release()
      else { listener({ requestId, chunk: 'own', done: false }); listener({ requestId, chunk: '', done: true }) }
      await Promise.resolve(); await Promise.resolve()
      expect(settled).toBe(false)
      if (order === 'result-first') { listener({ requestId, chunk: 'own', done: false }); listener({ requestId, chunk: '', done: true }) }
      else release()
      await running
      expect(rendered).toBe('own')
    } finally { release(); listener({ requestId, chunk: '', done: true }); await running; vi.unstubAllGlobals() }
  })
  it.each([true, false])('drains late text and tool events before settling an IPC result (ok=%s)', async ok => {
    let listener: (event: any) => void = () => {}, requestId = '', rendered = '', saved = '', toolState = 'waiting'
    const unsubscribe = vi.fn(), completed = vi.fn()
    vi.stubGlobal('window', { electronAPI: { ai: {
      onStreamEvent: (callback: typeof listener) => { listener = callback; return unsubscribe },
      cancelStream: vi.fn(),
      startStream: async (request: AIStreamRequest) => { requestId = request.requestId; return { ok, error: ok ? undefined : 'failed after partial text', waitForStreamEnd: true } }
    } } })
    const running = streamChat([], '', { ...DEFAULT_APP_CONFIG, apiKey: 'k', model: 'm' }, (text, done) => {
      if (done) { saved = rendered; completed(toolState) } else rendered += text
    }).catch(error => error)
    try {
      await Promise.resolve(); await Promise.resolve()
      expect(unsubscribe).not.toHaveBeenCalled()
      expect(completed).not.toHaveBeenCalled()
      toolState = 'denied'
      listener({ requestId, chunk: 'final reply', done: false })
      listener({ requestId, chunk: '', done: true })
      const result = await running
      expect(rendered).toBe('final reply')
      if (ok) { expect(saved).toBe('final reply'); expect(completed).toHaveBeenCalledExactlyOnceWith('denied') }
      else { expect(result).toBeInstanceOf(Error); expect(completed).not.toHaveBeenCalled() }
      expect(unsubscribe).toHaveBeenCalledOnce()
    } finally { listener({ requestId, chunk: '', done: true }); await running; vi.unstubAllGlobals() }
  })

  it('cancels while awaiting the stream end without leaving a pending listener', async () => {
    const controller = new AbortController(), cancelStream = vi.fn(), unsubscribe = vi.fn()
    vi.stubGlobal('window', { electronAPI: { ai: {
      onStreamEvent: () => unsubscribe, cancelStream,
      startStream: async () => ({ ok: true, waitForStreamEnd: true })
    } } })
    try {
      const onChunk = vi.fn(), running = streamChat([], '', { ...DEFAULT_APP_CONFIG, apiKey: 'k', model: 'm' }, onChunk, controller.signal).catch(error => error)
      await Promise.resolve(); await Promise.resolve(); controller.abort()
      expect(await running).toMatchObject({ name: 'AbortError' })
      expect(onChunk).not.toHaveBeenCalled(); expect(cancelStream).toHaveBeenCalledOnce(); expect(unsubscribe).toHaveBeenCalledOnce()
    } finally { vi.unstubAllGlobals() }
  })
  it('replaces retried text and the committed reply before saving once',async()=>{
    let listener:(event:any)=>void=()=>{},rendered='',saved=0,sourceSeen=false
    vi.stubGlobal('window',{electronAPI:{ai:{onStreamEvent:(fn:typeof listener)=>{listener=fn;return()=>{}},cancelStream:vi.fn(),startStream:async(request:AIStreamRequest)=>{
      listener({requestId:request.requestId,chunk:'old',done:false,operation:'append'})
      listener({requestId:request.requestId,chunk:'new',done:false,operation:'replace'})
      return {ok:true,reply:'committed',operation:'replace',harnessSource:{engine:'dsh',version:'v',requestId:'r',attemptId:'a',messageId:'stable'}}
    }}}})
    try{await streamChat([],'',{...DEFAULT_APP_CONFIG,apiKey:'k',model:'m'},(text,done,operation)=>{if(done){expect(sourceSeen).toBe(true);saved++}else rendered=operation==='replace'?text:rendered+text},undefined,undefined,undefined,undefined,undefined,()=>{sourceSeen=true})
      expect(rendered).toBe('committed');expect(saved).toBe(1)
    }finally{vi.unstubAllGlobals()}
  })
  it('parses OpenAI-compatible text and completion events', () => {
    expect(parseOpenAIStreamLine('data:{"choices":[{"delta":{"content":"你"}}]}')).toEqual({
      text: '你',
      done: false
    })
    expect(parseOpenAIStreamLine('data: [DONE]')).toEqual({ text: '', done: true })
    expect(parseOpenAIStreamLine('event: ping')).toBeNull()
  })

  it('ignores malformed OpenAI-compatible events', () => {
    expect(parseOpenAIStreamLine('data: not-json')).toBeNull()
  })

  it('parses Claude text and completion events', () => {
    expect(parseClaudeStreamLine('data: {"type":"content_block_delta","delta":{"text":"好"}}')).toEqual({
      text: '好',
      done: false
    })
    expect(parseClaudeStreamLine('data: {"type":"message_stop"}')).toEqual({ text: '', done: true })
  })

  it('normalizes and validates API URLs', () => {
    expect(joinApiUrl('https://api.example.com/v1/', '/chat/completions')).toBe(
      'https://api.example.com/v1/chat/completions'
    )
    expect(() => joinApiUrl('not-a-url', 'messages')).toThrow('Base URL 格式无效')
    expect(() => joinApiUrl('file:///tmp/api', 'messages')).toThrow('只支持 HTTP 或 HTTPS')
  })

  it('fails early when credentials are missing', async () => {
    await expect(streamChat([], '', { ...DEFAULT_APP_CONFIG, apiKey: '' }, vi.fn())).rejects.toThrow(
      '尚未配置 API Key'
    )
  })
  it('renders a durable operation receipt before completion even with no stream events', async () => {
    let rendered = '', saved = ''
    const unsubscribe = vi.fn()
    vi.stubGlobal('window', { electronAPI: { ai: {
      onStreamEvent: () => unsubscribe, cancelStream: vi.fn(),
      startStream: async () => ({ ok: true, reply: '任务新要求已保存' })
    } } })
    try {
      await streamChat([], '', { ...DEFAULT_APP_CONFIG, apiKey: 'key', model: 'model' }, (chunk, done) => { if (done) saved = rendered; else rendered += chunk })
      expect(saved).toBe('任务新要求已保存'); expect(unsubscribe).toHaveBeenCalledOnce()
    } finally { vi.unstubAllGlobals() }
  })

  it('exposes the request id before streaming so events can be routed by session', async () => {
    let streamListener: ((event: { requestId: string; chunk: string; done: boolean }) => void) | undefined
    const onRequestStart = vi.fn()
    const onChunk = vi.fn()
    vi.stubGlobal('window', {
      electronAPI: {
        ai: {
          onStreamEvent(callback: typeof streamListener) { streamListener = callback; return () => {} },
          cancelStream: vi.fn(),
          async startStream(request: { requestId: string }) {
            streamListener?.({ requestId: request.requestId, chunk: '好', done: false })
            streamListener?.({ requestId: request.requestId, chunk: '', done: true })
            return { ok: true }
          }
        }
      }
    })

    await streamChat([], '', { ...DEFAULT_APP_CONFIG, apiKey: 'key', model: 'model' }, onChunk, undefined, onRequestStart)

    expect(onRequestStart).toHaveBeenCalledOnce()
    expect(onChunk).toHaveBeenCalledWith('好', false)
    expect(onChunk).toHaveBeenCalledWith('', true)
    vi.unstubAllGlobals()
  })

  it('skips credential prechecks and forwards characterId when a character is set', async () => {
    let capturedRequest: AIStreamRequest | undefined
    const messages: Message[] = [{ id: 'm1', role: 'user', content: '你好', timestamp: 0 }]
    vi.stubGlobal('window', {
      electronAPI: {
        ai: {
          onStreamEvent: vi.fn(() => () => {}),
          cancelStream: vi.fn(),
          async startStream(request: AIStreamRequest) {
            capturedRequest = request
            return { ok: true }
          }
        }
      }
    })

    await expect(
      streamChat(
        messages,
        '系统提示',
        { ...DEFAULT_APP_CONFIG, apiKey: '', model: '' },
        vi.fn(),
        undefined,
        undefined,
        'c1'
      )
    ).resolves.toBeUndefined()

    expect(capturedRequest).toBeDefined()
    expect(capturedRequest?.requestId).toMatch(/^chat_/)
    expect(capturedRequest?.characterId).toBe('c1')
    expect(capturedRequest?.systemPrompt).toBe('系统提示')
    expect(capturedRequest?.messages).toEqual([{ role: 'user', content: '你好', imageUrl: undefined }])
    vi.unstubAllGlobals()
  })
})
