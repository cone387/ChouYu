import type { HarnessEngine } from '../../shared/harness'
import type { HarnessAdapter, HarnessEvent, HarnessInput, HarnessResult, HarnessSink } from './contracts'
import { HarnessRegistry } from './registry'

const terminalTypes = new Set(['completed', 'failed', 'cancelled', 'interrupted'])
const message = (error: unknown) => error instanceof Error ? error.message : 'AI 请求失败。'

export class HarnessCoordinator {
  private active = new Map<string, { abort: AbortController; settled: Promise<void> }>()
  constructor(private registry: HarnessRegistry, private readEngine: (characterId: string) => HarnessEngine = () => 'native', private platform: NodeJS.Platform = process.platform) {}
  engineFor(characterId?: string): HarnessEngine { return characterId ? this.readEngine(characterId) : 'native' }

  async run(input: HarnessInput, output: (event: HarnessEvent) => void, engine = this.engineFor(input.characterId)): Promise<HarnessResult> {
    let seq = 0, ended = false
    const publish: HarnessSink = update => output({ ...update, requestId: input.requestId, attemptId: input.attemptId, seq: ++seq })
    if (this.active.has(input.requestId)) {
      const result = { state: 'failed' as const, error: '相同请求仍在执行。' }
      publish({ type: result.state, error: result.error })
      return result
    }
    let resolveSettled!: () => void
    const abort = new AbortController(), settled = new Promise<void>(resolve => { resolveSettled = resolve })
    const signal = AbortSignal.any([input.signal, abort.signal])
    const emit: HarnessSink = update => { if (!ended && !signal.aborted && !terminalTypes.has(update.type)) publish(update) }
    this.active.set(input.requestId, { abort, settled })
    let adapter: HarnessAdapter | undefined, releaseTools: (() => void) | undefined
    let result: HarnessResult
    try {
      try {
        signal.throwIfAborted()
        const toolAbort = new AbortController()
        const bound = { ...input, signal, cancelTools: (reason: Error) => { toolAbort.abort(reason); input.cancelTools?.(reason) } }
        if (input.bindTools) bound.tools = input.bindTools({ ...bound, signal: AbortSignal.any([signal, toolAbort.signal]) })
        const prepared = this.registry.prepare(engine, bound, this.platform)
        adapter = this.registry.get(engine).adapter
        releaseTools = prepared.tools?.subscribe?.(event => emit({
          type: 'tool', callId: event.callId,
          status: event.status === 'requested' ? 'waiting-user' : event.status === 'running' ? 'running' : event.status === 'completed' ? 'completed' : 'failed',
          ...(event.pendingInteraction ? { pendingInteraction: true } : {})
        }))
        emit({ type: 'started', engine })
        result = await adapter.run(prepared, emit)
        signal.throwIfAborted()
        if (result.state === 'completed') await input.assertContext()
        signal.throwIfAborted()
        ended = true
      } catch (error) {
        ended = true
        let cleanupError = ''
        try { await adapter?.invalidate?.(input) }
        catch (cleanup) { cleanupError = ` 清理未完成：${message(cleanup)}` }
        result = { state: signal.aborted ? 'cancelled' : 'failed', error: (signal.aborted ? 'AI 请求已取消。' : message(error)) + cleanupError }
      }
      publish(result.state === 'completed' ? { type: 'completed', text: result.text, source: result.source } : { type: result.state, error: result.error })
      return result
    } finally {
      ended = true
      try { releaseTools?.() }
      finally { this.active.delete(input.requestId); resolveSettled() }
    }
  }
  async cancel(requestId: string): Promise<void> {
    const current = this.active.get(requestId)
    if (current) { current.abort.abort(); await current.settled }
  }
  async close(): Promise<void> {
    const runs = [...this.active.values()]
    for (const run of runs) run.abort.abort()
    await Promise.all(runs.map(run => run.settled))
  }
}
