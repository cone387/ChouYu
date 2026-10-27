import { createHash, randomUUID } from 'node:crypto'
import type { BackgroundHarness, BackgroundHarnessInput, HarnessModule, HarnessPurgeScope } from '../contracts'
import { DshRuntimePool, dshRuntimeGroup, type DshRunInput, type DshRuntimeOptions } from './runtime'
import { BackgroundLogs } from './background-logs'

class DshBackground implements BackgroundHarness {
  private active = new Map<AbortController, { characterId?: string; requestId: string; promise: Promise<void> }>()
  private purging = new Set<HarnessPurgeScope>()
  private purgeChains = new Map<string, Promise<void>>()
  private pool: DshRuntimePool
  private logs: BackgroundLogs
  private closed = false
  private closing?: Promise<void>
  constructor(options: DshRuntimeOptions) { this.pool = new DshRuntimePool(options); this.logs = new BackgroundLogs(options.home) }
  run(input: BackgroundHarnessInput): Promise<void> {
    if (this.closed) return Promise.reject(new Error('DSH 后台模块已关闭。'))
    input = { ...input, requestId: input.requestId ?? randomUUID() }
    if ([...this.purging].some(scope => scope.characterId === input.characterId && (!scope.requestIds || scope.requestIds.includes(input.requestId!)))) return Promise.reject(new Error('后台执行日志正在清理。'))
    const abort = new AbortController()
    const running = this.execute(input, abort).finally(() => { this.active.delete(abort) })
    this.active.set(abort, { characterId: input.characterId, requestId: input.requestId!, promise: running })
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
      signal, assertContext: async () => { signal.throwIfAborted() }, tools: input.tools, cancelTools: input.cancelTools, rounds: input.options ?? {} }
    let lease: Awaited<ReturnType<DshRuntimePool['acquire']>> | undefined
    try {
      signal.throwIfAborted()
      this.logs.begin({ characterId: input.characterId, requestId: request.requestId, attemptId: request.attemptId, runtimeGroup: dshRuntimeGroup(request) })
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
    this.closing = Promise.allSettled([...this.active.values()].map(value => value.promise).concat([...this.purgeChains.values()])).then(() => this.pool.close())
    return this.closing
  }
  purge(scope: HarnessPurgeScope) {
    this.purging.add(scope)
    const pending = (this.purgeChains.get(scope.characterId) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const active = [...this.active].filter(([, value]) => value.characterId === scope.characterId && (!scope.requestIds || scope.requestIds.includes(value.requestId)))
      for (const [abort] of active) abort.abort(new Error('后台执行日志已请求清理。'))
      await Promise.allSettled(active.map(([, value]) => value.promise))
      await this.logs.purge(scope)
    }).finally(() => { this.purging.delete(scope); if (this.purgeChains.get(scope.characterId) === pending) this.purgeChains.delete(scope.characterId) })
    this.purgeChains.set(scope.characterId, pending)
    return pending
  }
}

/** The worker variant imports no Electron main state or foreground chat services. */
export function createDshBackgroundModule(options: DshRuntimeOptions): HarnessModule {
  const background = new DshBackground(options)
  return { id: 'dsh', label: 'DeepSeek Harness',
    capabilities: { platforms: ['win32'], scenarios: [], images: false, systemHistory: false, tools: 'host', confirmation: 'return-card', recovery: 'none' },
    adapter: { run: async () => { throw new Error('请使用聊天进程中的 DSH 模块。') } },
    confirmation: () => ({ mode: 'return-card' }), background, lifecycle: { close: () => background.close(), purge: scope => background.purge(scope) } }
}
