import { describe, expect, it, vi } from 'vitest'
import { confirmMem0Event } from './mem0-event'
import { Mem0MemorySyncAdapter } from './mem0-adapter'

const id = '12345678-1234-1234-1234-123456789012'
const event = { id, event_type: 'ADD', status: 'SUCCEEDED', results: [{ id: 'memory', memory: 'test' }] }
describe('Mem0 write confirmation events', () => {
  it('connects a queued adapter write to the same-service event without repeating POST', async () => {
    const request = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => Response.json(init?.method === 'POST' ? { event_id: id, status: 'PENDING' } : event))
    const adapter = new Mem0MemorySyncAdapter({ baseUrl: 'https://example.com/proxy/v1', apiKey: 'fixture', userId: 'alice' }, request)
    expect((await adapter.rememberRaw('test'))[0].content).toBe('test')
    expect(request.mock.calls.map(call => call[1]?.method)).toEqual(['POST', 'GET'])
    expect(String(request.mock.calls[1][0])).toBe(`https://example.com/proxy/v1/event/${id}/`)
    expect(request.mock.calls[1][1]?.redirect).toBe('error')
  })
  it('polls pending/running states and returns only completed results', async () => {
    const read = vi.fn().mockResolvedValueOnce({ ...event, status: 'PENDING' }).mockResolvedValueOnce({ ...event, status: 'RUNNING' }).mockResolvedValue(event)
    expect(await confirmMem0Event({ event_id: id, status: 'PENDING' }, read, undefined, async () => {})).toEqual({ results: event.results })
    expect(read).toHaveBeenCalledTimes(3)
  })
  it.each([{ ...event, id: 'other' }, { ...event, event_type: 'SEARCH' }, { ...event, status: 'FAILED' }, { ...event, status: 'UNKNOWN' }, { ...event, results: null }])('rejects mismatched or unconfirmed results', async value => {
    await expect(confirmMem0Event({ event_id: id }, async () => value)).rejects.toThrow()
  })
  it('does not turn pending acknowledgement or exhausted polling into success', async () => {
    await expect(confirmMem0Event({ status: 'PENDING' }, vi.fn())).rejects.toThrow('缺少')
    const read = vi.fn(async () => ({ ...event, status: 'RUNNING' }))
    await expect(confirmMem0Event({ event_id: id }, read, undefined, async () => {})).rejects.toThrow('仍在处理')
    expect(read).toHaveBeenCalledTimes(30)
  })
  it('rejects cancellation before or during a response', async () => {
    const controller = new AbortController(); controller.abort()
    const read = vi.fn(async () => event)
    await expect(confirmMem0Event({ event_id: id }, read, controller.signal)).rejects.toThrow()
    expect(read).not.toHaveBeenCalled()
    const late = new AbortController()
    await expect(confirmMem0Event({ event_id: id }, async () => { late.abort(); return event }, late.signal)).rejects.toThrow()
  })
  it('preserves legacy synchronous results without requesting an event', async () => {
    const read = vi.fn()
    expect(await confirmMem0Event([event.results[0]], read)).toEqual(event.results)
    expect(read).not.toHaveBeenCalled()
  })
})
