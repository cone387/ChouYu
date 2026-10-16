export const REQUEST_TIMEOUT_MS = 60_000

export interface RequestGuard {
  signal: AbortSignal
  didTimeout: () => boolean
  cleanup: () => void
  timeoutMs: number
  progress: () => void
  textProgress: () => void
  timeoutMessage: () => string
}

export function createRequestGuard(externalSignal?: AbortSignal, timeoutMs = REQUEST_TIMEOUT_MS, streaming = false): RequestGuard {
  const controller = new AbortController()
  let timedOut = false
  let receivedProgress = false
  let receivedText = false
  let totalTimeout = false
  const startedAt = Date.now()
  const abortFromCaller = () => controller.abort(externalSignal?.reason)

  if (externalSignal?.aborted) abortFromCaller()
  else externalSignal?.addEventListener('abort', abortFromCaller, { once: true })

  const expire = () => {
    timedOut = true
    controller.abort()
  }
  let timer = setTimeout(expire, timeoutMs)
  const totalTimer = streaming ? setTimeout(() => { totalTimeout = true; expire() }, 10 * 60_000) : undefined

  return {
    signal: controller.signal,
    timeoutMs,
    progress: () => {
      if (!receivedProgress) console.log(`[AI] first stream event after ${Date.now() - startedAt}ms`)
      receivedProgress = true
      if (streaming && !controller.signal.aborted) {
        clearTimeout(timer)
        timer = setTimeout(expire, timeoutMs)
      }
    },
    textProgress: () => {
      if (!receivedText) console.log(`[AI] first text after ${Date.now() - startedAt}ms`)
      receivedText = true
    },
    timeoutMessage: () => totalTimeout
      ? '模型本轮响应超过 10 分钟，已停止等待，请重试。'
      : !streaming
        ? `请求超过 ${Math.round(timeoutMs / 1000)} 秒未完成，模型服务或网络响应超时，请重试。`
        : receivedProgress
          ? `模型响应中断，连续 ${Math.round(timeoutMs / 1000)} 秒未收到新数据，请重试。`
          : `等待模型响应超过 ${Math.round(timeoutMs / 1000)} 秒，可能是模型排队、推理较慢或网络延迟，请重试。`,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timer)
      clearTimeout(totalTimer)
      console.log(`[AI] round finished after ${Date.now() - startedAt}ms; timedOut=${timedOut}`)
      externalSignal?.removeEventListener('abort', abortFromCaller)
    }
  }
}

export function rethrowRequestError(error: unknown, guard: RequestGuard): never {
  if (guard.didTimeout()) {
    throw new Error(guard.timeoutMessage())
  }
  throw error
}

export async function readSseStream(body: ReadableStream<Uint8Array>, onPayload: (payload: unknown) => void): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let completed = false
  const consumeLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const data = trimmed.slice(5).trimStart()
    if (!data) return
    if (data === '[DONE]') { completed = true; return }
    let payload: any
    try { payload = JSON.parse(data) } catch { return }
    onPayload(payload)
    if (payload?.type === 'message_stop') completed = true
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        consumeLine(line)
        if (completed) return
      }
    }

    buffer += decoder.decode()
    if (buffer) buffer.split('\n').forEach(consumeLine)
  } finally {
    // Some gateways keep the HTTP connection open after the protocol end event.
    // Do not wait for transport EOF (or for a potentially stalled cancel).
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
