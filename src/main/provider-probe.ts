import type { AppConfig } from '../shared/config'
import { isAIConfigured } from '../shared/config'
import { joinApiUrl, type ConversationDiagnostics } from '../shared/ai'

/** Explicit diagnostic: synthetic text only, no user history or tools. */
export async function probeConversation(config: AppConfig, request: typeof fetch = fetch): Promise<ConversationDiagnostics> {
  const start = Date.now()
  const result: ConversationDiagnostics = { state: 'unconfigured', requestedModel: config.model, completed: false, elapsedMs: 0, message: '请先配置地址、密钥和模型。' }
  if (!isAIConfigured(config)) return result
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const redact = (text: string) => config.apiKey ? text.replaceAll(config.apiKey, '[已隐藏]') : text
  try {
    const claude = config.provider === 'claude'
    const body: Record<string, unknown> = { model: config.model, stream: true, max_tokens: 512, messages: [{ role: 'user', content: 'Reply with only OK.' }] }
    if (!claude && config.thinkingDisabledModels?.includes(config.model)) body.thinking = { type: 'disabled' }
    const response = await request(joinApiUrl(config.baseUrl, claude ? 'messages' : 'chat/completions'), {
      method: 'POST', signal: controller.signal,
      headers: claude ? { 'Content-Type': 'application/json', 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' }
        : { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(body)
    })
    result.httpStatus = response.status
    if (!response.ok) throw new Error(`API error ${response.status}: ${redact(await response.text()).slice(0, 2000)}`)
    if (!response.body) throw new Error('接口返回空响应。')
    reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = '', bytes = 0, reply = '', finish = ''
    const line = (raw: string) => {
      if (!raw.startsWith('data:')) return
      const value = raw.slice(5).trim()
      if (value === '[DONE]') { result.completed = true; return }
      const event = JSON.parse(value)
      if (event.error || event.type === 'error') throw new Error(JSON.stringify(event.error ?? event))
      result.returnedModel = event.model ?? event.message?.model ?? result.returnedModel
      if (claude) {
        if (event.type === 'content_block_delta') reply += event.delta?.text ?? ''
        if (event.type === 'message_delta') finish = event.delta?.stop_reason ?? finish
        if (event.type === 'message_stop') result.completed = true
      } else {
        reply += event.choices?.[0]?.delta?.content ?? ''
        if (event.choices?.[0]?.finish_reason) { finish = event.choices[0].finish_reason; result.completed = true }
      }
      result.reply = redact(reply).slice(0, 1000)
    }
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > 256000) throw new Error('诊断响应过长，已停止读取。')
      buffer += decoder.decode(chunk.value, { stream: true })
      const lines = buffer.split('\n'); buffer = lines.pop()!
      for (const value of lines) line(value.trimEnd())
    }
    buffer += decoder.decode()
    if (buffer.trim()) line(buffer.trimEnd())
    result.reply = redact(reply).slice(0, 1000)
    if (!reply.trim()) throw new Error('接口没有返回对话正文，不能确认模型可用。')
    if (!result.completed) throw new Error('响应流未正常结束，不能确认完整回复。')
    if (finish && !['stop', 'end_turn', 'stop_sequence'].includes(finish)) throw new Error(`回复未完整生成（${finish}）。`)
    result.state = 'ready'; result.message = '已收到真实对话正文，响应流正常结束。'
  } catch (error) {
    result.state = 'error'
    result.message = controller.signal.aborted ? '对话诊断超过 30 秒，已停止。' : redact(error instanceof Error ? error.message : String(error)).slice(0, 2000)
  } finally {
    clearTimeout(timer); controller.abort(); await reader?.cancel().catch(() => {})
    result.elapsedMs = Date.now() - start
    if (result.returnedModel) result.returnedModel = redact(result.returnedModel).slice(0, 200)
  }
  return result
}
