import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { ChatService, type ChatExecution, type ChatSender } from './service'
import type { AIStreamRequest } from '../../shared/ai'
import { AgentSpace } from '../agent-space/service'
import type { HarnessCoordinator } from '../harness/coordinator'
import type { HarnessInput, HarnessResult } from '../harness/contracts'
import { DEFAULT_APP_CONFIG } from '../../shared/config'

class Sender extends EventEmitter implements ChatSender {
  constructor(readonly id: number) { super() }
  isDestroyed() { return false }
  send = vi.fn()
}
const request: AIStreamRequest = { requestId: 'same', characterId: 'alice', systemPrompt: '', messages: [{ role: 'user', content: 'hello' }] }
function heldExecution() {
  const runs: { execution: ChatExecution; release(): void }[] = []
  const service = new ChatService({ execute: execution => new Promise(resolve => {
    runs.push({ execution, release: () => resolve({ ok: !execution.controller.signal.aborted }) })
  }) })
  return { service, runs }
}

describe('chat application lifetime', () => {
  it('isolates equal renderer request ids and retains requests while panels are hidden', async () => {
    const { service, runs } = heldExecution()
    const a = new Sender(1), b = new Sender(2)
    const first = service.run(a, request), second = service.run(b, request)
    await vi.waitFor(() => expect(runs).toHaveLength(2))
    a.emit('hide'); a.emit('did-start-navigation', {}, '#chat', true, true)
    expect(runs.every(r => !r.execution.controller.signal.aborted)).toBe(true)
    service.cancel(1, 'same')
    expect(runs[0].execution.controller.signal.aborted).toBe(true)
    expect(runs[1].execution.controller.signal.aborted).toBe(false)
    expect(runs.map(r => r.execution.requestKey)).toEqual(['1:same', '2:same'])
    runs.forEach(r => r.release())
    await Promise.all([first, second])
    expect(a.listenerCount('destroyed')).toBe(0)
    expect(b.listenerCount('destroyed')).toBe(0)
  })

  it.each(['destroyed', 'render-process-gone'])('cancels a lost sender and waits for the actual execution to exit: %s', async event => {
    const { service, runs } = heldExecution()
    const sender = new Sender(1), running = service.run(sender, request)
    await vi.waitFor(() => expect(runs).toHaveLength(1))
    sender.emit(event)
    expect(runs[0].execution.controller.signal.aborted).toBe(true)
    let finished = false
    const closing = service.close().then(() => { finished = true })
    await Promise.resolve()
    expect(finished).toBe(false)
    runs[0].release()
    await Promise.all([running, closing])
    expect(finished).toBe(true)
    expect(sender.eventNames()).toEqual([])
    expect(await service.run(sender, request)).toMatchObject({ ok: false })
  })

  it('close aborts context preparation and awaits all outstanding generations including replaced ids', async () => {
    const { service, runs } = heldExecution()
    const sender = new Sender(1)
    const first = service.run(sender, request)
    await vi.waitFor(() => expect(runs).toHaveLength(1))
    const second = service.run(sender, request)
    await vi.waitFor(() => expect(runs).toHaveLength(2))
    expect(runs[0].execution.controller.signal.aborted).toBe(true)
    const closing = service.close()
    expect(service.close()).toBe(closing)
    expect(runs[1].execution.controller.signal.aborted).toBe(true)
    let closed = false
    void closing.then(() => { closed = true })
    runs[1].release(); await second
    expect(closed).toBe(false)
    runs[0].release(); await first; await closing
    expect(closed).toBe(true)
  })

  it('cleans sender listeners after executor failure and allows retrying the request', async () => {
    const sender = new Sender(1)
    const execute = vi.fn().mockRejectedValueOnce(new Error('fixture')).mockResolvedValue({ ok: true })
    const service = new ChatService({ execute })
    await expect(service.run(sender, request)).rejects.toThrow('fixture')
    expect(sender.eventNames()).toEqual([])
    await expect(service.run(sender, request)).resolves.toEqual({ ok: true })
    expect(sender.eventNames()).toEqual([])
    await service.close()
  })

  it('runs through ContactAgent.Chat and removing one contact waits for its tool without cancelling a peer', async () => {
    const live = new Map<string, { signal: AbortSignal; release(): void }>()
    const work = { request: vi.fn(), remove: vi.fn().mockResolvedValue(undefined), detach: vi.fn() }
    const space = new AgentSpace({ modules: ['chat'], work,
      readIdentity: id => ({ id, soul: id, conversation: '', config: DEFAULT_APP_CONFIG }),
      harness: { run: (input: HarnessInput) => new Promise<HarnessResult>(resolve => {
        live.set(input.characterId!, { signal: input.signal, release: () => resolve({ state: 'cancelled', error: 'stopped' } as HarnessResult) })
      }) } as unknown as HarnessCoordinator })
    const service = new ChatService({ execute: async ({ request, requestKey, controller }) => {
      const result = await space.runChat({ characterId: request.characterId, requestId: requestKey,
        sessionId: request.characterId, signal: controller.signal, messages: request.messages,
        config: DEFAULT_APP_CONFIG, systemPrompt: request.systemPrompt } as HarnessInput, () => {})
      return { ok: result.state === 'completed' }
    }, close: () => space.close() })
    const alice = service.run(new Sender(1), request)
    const bob = service.run(new Sender(2), { ...request, characterId: 'bob' })
    await vi.waitFor(() => expect(live.size).toBe(2))
    let removed = false
    const deletion = space.remove('alice').then(() => { removed = true })
    expect(live.get('alice')!.signal.aborted).toBe(true)
    expect(live.get('bob')!.signal.aborted).toBe(false)
    await Promise.resolve(); expect(removed).toBe(false)
    live.get('alice')!.release(); await alice; await deletion
    expect(work.remove).toHaveBeenCalledWith('alice')
    expect(live.get('bob')!.signal.aborted).toBe(false)
    live.get('bob')!.release(); await bob; await service.close()
  })
})
