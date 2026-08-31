import type { ChildProcess } from 'child_process'

export type ProcessCapabilityMethod = 'initialize' | 'close' | 'list' | 'search' | 'create' | 'update' | 'delete' | 'stats'

export interface ProcessCapabilityManifest {
  id: string
  command: string
  args?: string[]
  cwd?: string
  protocol: 'jsonl'
  timeoutMs?: number
}

export interface ProcessCapabilityRequest {
  id: string
  method: ProcessCapabilityMethod
  params?: Record<string, unknown>
}

export interface ProcessCapabilityResponse {
  id: string
  ok: boolean
  result?: unknown
  error?: string
}

export function validateProcessCapabilityManifest(value: unknown): ProcessCapabilityManifest {
  if (!value || typeof value !== 'object') throw new Error('进程能力清单无效。')
  const input = value as Record<string, unknown>
  if (typeof input.id !== 'string' || !/^[a-z0-9][a-z0-9.-]{1,79}$/.test(input.id)) throw new Error('进程能力 ID 无效。')
  if (typeof input.command !== 'string' || !input.command.trim() || input.command.length > 260) throw new Error('进程能力命令无效。')
  if (input.protocol !== 'jsonl') throw new Error('进程能力只支持 JSONL 协议。')
  if (input.args !== undefined && (!Array.isArray(input.args) || input.args.some((arg) => typeof arg !== 'string' || arg.length > 1000))) throw new Error('进程能力参数无效。')
  if (input.cwd !== undefined && (typeof input.cwd !== 'string' || input.cwd.length > 1000)) throw new Error('进程能力工作目录无效。')
  const timeoutMs = input.timeoutMs === undefined ? 30_000 : Number(input.timeoutMs)
  if (!Number.isFinite(timeoutMs) || timeoutMs < 500 || timeoutMs > 120_000) throw new Error('进程能力超时范围无效。')
  return { id: input.id, command: input.command, args: (input.args as string[] | undefined)?.slice(0, 32), cwd: input.cwd as string | undefined, protocol: 'jsonl', timeoutMs }
}

export interface ProcessCapabilityTransport {
  process: ChildProcess
  request(request: ProcessCapabilityRequest, signal?: AbortSignal): Promise<ProcessCapabilityResponse>
  close(): Promise<void>
}

/**
 * Process boundary contract for optional heavy capabilities such as Mem0 OSS.
 * The transport implementation is intentionally kept separate from the built-in
 * registry so an untrusted or missing helper cannot affect the main process.
 */
export const PROCESS_CAPABILITY_PROTOCOL_VERSION = 1
