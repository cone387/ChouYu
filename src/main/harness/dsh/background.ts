import { createHash, randomUUID } from 'node:crypto'
import type { BackgroundHarness, BackgroundHarnessInput, HarnessModule } from '../contracts'
import { DshRuntimePool, type DshRunInput } from './runtime'

class DshBackground implements BackgroundHarness {
  private active = new Map<AbortController, Promise<void>>()
  private closed = false
  private closing?: Promise<void>
  constructor(private pool: DshRuntimePool) {}
  run(input: BackgroundHarnessInput): Promise<void> {
    if (this.closed) return Promise.reject(new Error('DSH 后台模块已关闭。'))
    const abort = new AbortController()
    const running = this.execute(input, abort).finally(() => { this.active.delete(abort) })
    this.active.set(abort, running)
    return running
  }
  private async execute(input: BackgroundHarnessInput, abort: AbortController) {
    if (!input.characterId) throw new Error('DSH 后台请求缺少联系人归属。')
    const timeoutMs = input.options?.timeoutMs ?? 180000
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('DSH 后台超时设置无效。')
    const signal = AbortSignal.any([input.signal, abort.signal])
    const timer = setTimeout(() => abort.abort(new Error('DSH 后台请求超时。')), timeoutMs)
    timer.unref()
    const version = createHash('sha256').update(JSON.stringify([input.config.provider, input.config.baseUrl, input.config.apiKey, input.config.model])).digest('hex')
    const request: DshRunInput = { requestId: input.requestId ?? randomUUID(), attemptId: randomUUID(), characterId: input.characterId,
      messages: input.messages, systemPrompt: input.systemPrompt, config: input.config, configVersion: version, snapshotFingerprint: version,
      signal, assertContext: async () => { signal.throwIfAborted() }, tools: input.tools, rounds: input.options ?? {} }
    let lease: Awaited<ReturnType<DshRuntimePool['acquire']>> | undefined
    try {
      signal.throwIfAborted()
      lease = await this.pool.acquire(request)
      const result = await lease.run(request, event => {
        if (event.type === 'text' && event.operation === 'append') input.onChunk(event.text, false)
      })
      signal.throwIfAborted()
      if (result.state !== 'completed') throw new Error(result.error)
      input.onChunk('', true)
    } catch (error) { if (signal.aborted) throw signal.reason; throw error }
    finally { clearTimeout(timer); await lease?.release() }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true
    for (const abort of this.active.keys()) abort.abort(new Error('DSH 后台模块已关闭。'))
    this.closing = Promise.allSettled([...this.active.values()]).then(() => this.pool.close())
    return this.closing
  }
}

/** The worker variant imports no Electron main state or foreground chat services. */
export function createDshBackgroundModule(pool: DshRuntimePool): HarnessModule {
  const background = new DshBackground(pool)
  return { id: 'dsh', label: 'DeepSeek Harness',
    capabilities: { platforms: ['win32'], scenarios: [], images: false, systemHistory: false, tools: 'host', confirmation: 'return-card', recovery: 'none' },
    adapter: { run: async () => { throw new Error('请使用聊天进程中的 DSH 模块。') } },
    confirmation: () => ({ mode: 'return-card' }), background, lifecycle: { close: () => background.close() } }
}
