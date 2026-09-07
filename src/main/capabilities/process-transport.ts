import { spawn } from 'child_process'
import { realpathSync } from 'fs'
import path from 'path'
import { StringDecoder } from 'string_decoder'
import { validateProcessCapabilityManifest, type ProcessCapabilityManifest, type ProcessCapabilityRequest, type ProcessCapabilityResponse, type ProcessCapabilityTransport } from './process-bridge'

const METHODS = new Set(['initialize', 'close', 'list', 'search', 'create', 'update', 'delete', 'stats'])
const MAX_FRAME_BYTES = 1_000_000

/** Only a trusted host may select executable paths and arguments. This is fault isolation, not an OS sandbox. */
export function createProcessCapabilityTransport(input: ProcessCapabilityManifest, allowedExecutables: readonly string[]): ProcessCapabilityTransport {
  const manifest = validateProcessCapabilityManifest(input)
  if (!path.isAbsolute(manifest.command)) throw new Error('能力进程必须使用已授权的绝对可执行文件路径。')
  const canonical = (filename: string) => {
    const resolved = realpathSync(filename)
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  if (!allowedExecutables.some(filename => path.isAbsolute(filename) && canonical(filename) === canonical(manifest.command))) throw new Error('能力进程未在可执行文件授权列表中。')
  if (manifest.cwd && !path.isAbsolute(manifest.cwd)) throw new Error('能力进程工作目录必须是绝对路径。')
  const child = spawn(manifest.command, manifest.args || [], {
    cwd: manifest.cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, LANG: process.env.LANG }
  })
  let failure: Error | undefined
  let buffer = ''
  const decoder = new StringDecoder('utf8')
  const pending = new Map<string, { resolve: (response: ProcessCapabilityResponse) => void; reject: (error: Error) => void; cleanup: () => void }>()
  let resolveClosed!: () => void
  const closed = new Promise<void>(resolve => { resolveClosed = resolve })

  const stop = (error: Error) => {
    if (failure) return
    failure = error
    buffer = ''
    for (const request of pending.values()) { request.cleanup(); request.reject(error) }
    pending.clear()
    child.kill('SIGKILL')
  }
  child.once('error', error => stop(new Error(`能力进程无法启动：${error.message}`)))
  child.once('close', () => { stop(new Error('能力进程已退出，请重新连接；未自动重试写入操作。')); resolveClosed() })
  child.stdin.on('error', error => stop(new Error(`能力进程输入失败：${error.message}`)))
  child.stderr.on('data', () => { /* Drain diagnostics without retaining potentially sensitive/unbounded helper output. */ })
  child.stdout.on('data', (chunk: Buffer) => {
    if (failure) return
    buffer += decoder.write(chunk)
    for (;;) {
      const newline = buffer.indexOf('\n')
      if (newline < 0) break
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (Buffer.byteLength(line) > MAX_FRAME_BYTES) { stop(new Error('能力进程响应超过大小限制。')); return }
      try {
        const response = JSON.parse(line) as ProcessCapabilityResponse
        if (!response || typeof response.id !== 'string' || typeof response.ok !== 'boolean' || (response.error !== undefined && typeof response.error !== 'string')) throw new Error('invalid response')
        const request = pending.get(response.id)
        if (!request) throw new Error('unknown response ID')
        pending.delete(response.id)
        request.cleanup()
        request.resolve(response)
      } catch { stop(new Error('能力进程返回无效 JSONL 协议数据。')); return }
    }
    if (Buffer.byteLength(buffer) > MAX_FRAME_BYTES) stop(new Error('能力进程响应超过大小限制。'))
  })

  return {
    process: child,
    request(request: ProcessCapabilityRequest, signal?: AbortSignal): Promise<ProcessCapabilityResponse> {
      if (failure) return Promise.reject(failure)
      if (signal?.aborted) return Promise.reject(new Error('能力请求已取消。'))
      if (!request || typeof request.id !== 'string' || !/^[a-zA-Z0-9._-]{1,80}$/.test(request.id) || !METHODS.has(request.method)) return Promise.reject(new Error('能力请求格式无效。'))
      if (pending.has(request.id) || pending.size >= 32) return Promise.reject(new Error('能力请求重复或并发数量超限。'))
      let encoded: string
      try { encoded = JSON.stringify(request) + '\n' } catch { return Promise.reject(new Error('能力请求无法序列化。')) }
      if (Buffer.byteLength(encoded) > MAX_FRAME_BYTES) return Promise.reject(new Error('能力请求超过大小限制。'))
      return new Promise((resolve, reject) => {
        const abort = () => stop(new Error('能力请求已取消，进程已停止；操作结果可能未知。'))
        const timer = setTimeout(() => stop(new Error('能力请求超时，进程已停止；操作结果可能未知，请检查后重新连接。')), manifest.timeoutMs)
        const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
        pending.set(request.id, { resolve, reject, cleanup })
        signal?.addEventListener('abort', abort, { once: true })
        child.stdin.write(encoded, error => { if (error) stop(error) })
      })
    },
    async close(): Promise<void> {
      stop(new Error('能力进程连接已关闭。'))
      await closed
    }
  }
}
