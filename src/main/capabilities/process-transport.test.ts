import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { createProcessCapabilityTransport } from './process-transport'
import type { ProcessCapabilityTransport } from './process-bridge'

const transports: ProcessCapabilityTransport[] = []
const manifest = { id: 'test-helper', command: process.execPath, args: [path.resolve('tests/fixtures/capability-helper.cjs')], protocol: 'jsonl' as const, timeoutMs: 500 }
const connect = (timeoutMs = 3000) => {
  const transport = createProcessCapabilityTransport({ ...manifest, timeoutMs }, [process.execPath])
  transports.push(transport)
  return transport
}
afterEach(async () => { await Promise.all(transports.splice(0).map(transport => transport.close())) })

describe('actual capability child process', () => {
  it('requires an absolute allowlisted executable and rejects excess arguments', () => {
    expect(() => createProcessCapabilityTransport({ ...manifest, command: 'node' }, [process.execPath])).toThrow('绝对')
    expect(() => createProcessCapabilityTransport(manifest, [])).toThrow('授权')
    expect(() => createProcessCapabilityTransport({ ...manifest, args: Array(33).fill('arg') }, [process.execPath])).toThrow('参数')
  })

  it('correlates out-of-order replies and preserves split UTF-8 without inheriting credentials', async () => {
    process.env.CHOUYU_TEST_SECRET = 'synthetic-test-value'
    let transport: ProcessCapabilityTransport
    try { transport = connect() } finally { delete process.env.CHOUYU_TEST_SECRET }
    const first = transport.request({ id: 'slow', method: 'search', params: { delay: 60 } })
    const second = transport.request({ id: 'fast', method: 'stats' })
    expect(await second).toMatchObject({ id: 'fast', result: { text: '中文响应', inheritedSecret: false, inheritedNodeOptions: false } })
    expect(await first).toMatchObject({ id: 'slow', ok: true })
  })

  it('rejects duplicate pending IDs without corrupting the original request', async () => {
    const transport = connect()
    const first = transport.request({ id: 'same', method: 'search', params: { delay: 50 } })
    await expect(transport.request({ id: 'same', method: 'list' })).rejects.toThrow('重复')
    await expect(first).resolves.toMatchObject({ ok: true })
  })

  it.each(['timeout', 'crash', 'malformed', 'oversize'])('isolates %s and permits explicit reconnection without replay', async mode => {
    const transport = connect(mode === 'timeout' ? 500 : 3000)
    const expected = { timeout: '超时', crash: '退出', malformed: '无效 JSONL', oversize: '大小限制' }[mode]
    await expect(transport.request({ id: 'write', method: 'create', params: { mode } })).rejects.toThrow(expected)
    await expect(transport.request({ id: 'later', method: 'list' })).rejects.toThrow()
    const replacement = connect()
    await expect(replacement.request({ id: 'initialize', method: 'initialize', params: { protocolVersion: 1 } })).resolves.toMatchObject({ result: { protocolVersion: 1 } })
  })

  it('aborts a pending request and settles every request on that process', async () => {
    const transport = connect()
    const controller = new AbortController()
    const first = expect(transport.request({ id: 'one', method: 'search', params: { mode: 'timeout' } }, controller.signal)).rejects.toThrow('取消')
    const second = expect(transport.request({ id: 'two', method: 'list', params: { mode: 'timeout' } })).rejects.toThrow('取消')
    controller.abort()
    await Promise.all([first, second])
  })
})
