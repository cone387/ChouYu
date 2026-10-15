import type { HarnessEngine } from '../../shared/harness'
import type { HarnessAdapter, HarnessEvent, HarnessInput, HarnessResult, HarnessSink } from './contracts'

export class HarnessCoordinator {
  private active = new Map<string, { abort: AbortController; settled: Promise<void> }>()
  constructor(private adapters: Partial<Record<HarnessEngine, HarnessAdapter>>, private env: NodeJS.ProcessEnv = process.env, private platform: NodeJS.Platform = process.platform) {}

  engineFor(characterId?: string): HarnessEngine {
    return characterId && characterId === this.env.CHOUYU_DSH_PILOT_CHARACTER_ID ? 'dsh' : 'legacy'
  }

  async run(input: HarnessInput, output: (event: HarnessEvent) => void): Promise<HarnessResult> {
    const engine = this.engineFor(input.characterId)
    let seq = 0, terminal = false
    const emit: HarnessSink = update => { if (!terminal) output({ ...update, requestId: input.requestId, attemptId: input.attemptId, seq: ++seq }) }
    let resolveSettled!: () => void
    const abort = new AbortController(), settled = new Promise<void>(resolve => { resolveSettled = resolve })
    // Calls are main-owned; renderer cancellation still enters its original sender-scoped controller.
    if (this.active.has(input.requestId)) return { state: 'failed', error: '相同请求仍在执行。' }
    this.active.set(input.requestId, { abort, settled })
    const signal = AbortSignal.any([input.signal, abort.signal])
    let result: HarnessResult
    try {
      signal.throwIfAborted()
      const adapter = this.adapters[engine]
      if (engine === 'dsh' && this.platform !== 'win32') throw new Error('此平台尚未验证 DSH，尚未执行。')
      if (!adapter) throw new Error('DSH 执行器尚不可用，本次未执行。')
      emit({ type: 'started', engine })
      result = await adapter.run({ ...input, signal }, emit)
      signal.throwIfAborted()
      if (result.state === 'completed') await input.assertContext()
    } catch (error) {
      result = { state: signal.aborted ? 'cancelled' : 'failed', error: signal.aborted ? 'AI 请求已取消。' : error instanceof Error ? error.message : 'AI 请求失败。' }
    } finally {
      this.active.delete(input.requestId)
      resolveSettled()
    }
    emit(result.state === 'completed' ? { type: 'completed', text: result.text, source: result.source } : { type: result.state, error: result.error })
    terminal = true
    return result
  }

  async cancel(requestId: string): Promise<void> {
    const current = this.active.get(requestId)
    if (current) { current.abort.abort(); await current.settled }
  }
}
