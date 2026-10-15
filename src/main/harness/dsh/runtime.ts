import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DshTransport } from './transport'
import type { RpcPeer } from '../../../../runtime/dsh/wire.mjs'
import { mapProvider } from '../../../../runtime/dsh/provider.mjs'
import type { HarnessInput, HarnessResult, HarnessSink, RunKey } from '../contracts'

export interface DshRuntimeLease {
  run(input:HarnessInput, emit:HarnessSink):Promise<HarnessResult>
  cancel(key:RunKey):Promise<void>
  flush(key:RunKey):Promise<boolean>
  release():void
}
export interface DshRuntimeOptions { home:string; node:string; helper:string }
type Active = { input:HarnessInput; emit:HarnessSink }

class DshRuntime {
  private transport: DshTransport
  private child?: ChildProcess
  private helper?: RpcPeer
  private plugin?: RpcPeer
  private active = new Map<string, Active>()
  private closed = false
  private closePromise?: Promise<void>
  constructor(private options:DshRuntimeOptions) {
    this.transport = new DshTransport(async (role, method, value) => {
      if (role !== 'plugin' || !value || typeof value.sessionId !== 'string') throw new Error('DSH 事件归属无效。')
      const current = this.active.get(value.sessionId)
      if (!current || current.input.requestId !== value.requestId || current.input.attemptId !== value.attemptId) throw new Error('DSH 请求已经结束或归属无效。')
      const { input, emit } = current
      if (input.signal.aborted) throw new Error('AI 请求已取消。')
      if (method === 'tool') {
        if (typeof value.callId !== 'string' || typeof value.name !== 'string' || !input.tools?.definitions.some(t => t.name === value.name)) throw new Error('DSH 工具不在本次授权目录内。')
        await input.assertContext(); input.signal.throwIfAborted()
        emit({ type: 'tool', callId: value.callId, status: 'running' })
        const result = await input.tools.execute({ id: value.callId, name: value.name, arguments: JSON.stringify(value.args) })
        emit({ type: 'tool', callId: value.callId, status: 'completed' })
        return result
      }
      if (method === 'stream') {
        // The full revision/index reducer is integrated in the streaming task.
        const frame = value.frame
        if (frame?.type === 'chunk' && frame.chunk?.type === 'text-delta') emit({ type: 'text', text: frame.chunk.text, operation: 'append' })
        return true
      }
      throw new Error('DSH 事件类型无效。')
    }, () => { if (!this.closed) void this.close() })
  }
  async start(input:HarnessInput):Promise<void> {
    mapProvider(input.config, { tools: Boolean(input.tools?.definitions.length), images: input.messages.some(m => Boolean(m.imageUrl)) })
    mkdirSync(this.options.home, { recursive: true })
    const port = await this.transport.listen()
    const env:NodeJS.ProcessEnv = {}
    for (const key of ['SystemRoot','WINDIR','PATH','Path','PATHEXT','COMSPEC','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA']) if (process.env[key]) env[key] = process.env[key]
    Object.assign(env, { CHOUYU_DSH_PORT: String(port), CHOUYU_DSH_TOKEN: this.transport.token, CHOUYU_DSH_HOME: this.options.home,
      CHOUYU_DSH_CONFIG: JSON.stringify({ provider: input.config.provider, baseUrl: input.config.baseUrl, model: input.config.model }), CHOUYU_DSH_API_KEY: input.config.apiKey })
    this.child = spawn(this.options.node, [this.options.helper, '--serve'], { env, windowsHide: true, stdio: ['ignore','ignore','pipe'] })
    // Consume stderr without retaining secrets or unbounded child output.
    this.child.stderr?.resume()
    this.child.once('error', () => { void this.close() })
    this.child.once('exit', () => { if (!this.closed) void this.close() })
    try {
      this.helper = await this.transport.wait('helper')
      await this.helper.request('ready', {}, { timeoutMs: 35000 })
      this.plugin = await this.transport.wait('plugin')
    } catch (error) { await this.close(); throw error }
  }
  async run(input:HarnessInput, emit:HarnessSink):Promise<HarnessResult> {
    if (this.closed || !this.helper || !this.plugin) throw new Error('DSH 运行时不可用。')
    if (this.active.has(input.attemptId)) throw new Error('DSH 尝试已经在执行。')
    const last = input.messages.at(-1)
    if (!last || last.role !== 'user') throw new Error('DSH 当前输入必须是最后一条用户消息，尚未执行。')
    this.active.set(input.attemptId, {input, emit})
    let cancelling:Promise<void> | undefined
    const abort = () => { cancelling = this.cancel(input).catch(() => {}); }
    input.signal.addEventListener('abort', abort, {once:true})
    try {
      input.signal.throwIfAborted(); await input.assertContext()
      await this.plugin.request('prepare', { requestId:input.requestId,attemptId:input.attemptId,sessionId:input.attemptId, history:input.messages.slice(0,-1), systemPrompt:input.systemPrompt, tools:input.tools?.definitions ?? [], model:input.config.model }, {timeoutMs:30000})
      input.signal.throwIfAborted()
      const result = await this.plugin.request('run', {requestId:input.requestId,attemptId:input.attemptId,sessionId:input.attemptId,prompt:last.content}) as HarnessResult
      if (result.state === 'completed' && !await this.flush(input)) throw new Error('DSH 回复尚未确认落盘。')
      return result
    } finally {
      input.signal.removeEventListener('abort', abort)
      await cancelling
      this.active.delete(input.attemptId)
    }
  }
  async cancel(key:RunKey):Promise<void> { if (this.plugin && !this.closed) await this.plugin.request('cancel', { ...key, sessionId:key.attemptId }, {timeoutMs:15000}) }
  async flush(key:RunKey):Promise<boolean> { return Boolean(await this.plugin?.request('flush', {...key,sessionId:key.attemptId}, {timeoutMs:15000})) }
  release(key:RunKey):void { if (this.plugin && !this.closed) void this.plugin.request('dispose', {...key,sessionId:key.attemptId}, {timeoutMs:15000}).catch(() => {}) }
  close():Promise<void> {
    return this.closePromise ??= (async () => {
      this.closed = true
      try { await this.helper?.request('close', {}, {timeoutMs:15000}) } catch { /* SDK/process failure; reap below. */ }
      await this.transport.close()
      const child = this.child
      if (child && child.exitCode === null && child.signalCode === null) await new Promise<void>(resolve => {
        const timer = setTimeout(() => { child.kill(); }, 3000)
        child.once('exit', () => { clearTimeout(timer); resolve() })
        if (!child.pid) { clearTimeout(timer); resolve() }
      })
    })()
  }
}

export class DshRuntimePool {
  private groups = new Map<string,Promise<DshRuntime>>()
  constructor(private options:DshRuntimeOptions) {}
  async acquire(input:HarnessInput):Promise<DshRuntimeLease> {
    const group = createHash('sha256').update(JSON.stringify([input.config.provider,input.config.baseUrl,input.config.model,input.configVersion])).digest('hex')
    let pending = this.groups.get(group)
    if (!pending) {
      const runtime = new DshRuntime({...this.options,home:join(this.options.home,group)})
      pending = runtime.start(input).then(() => runtime).catch(error => {this.groups.delete(group);throw error})
      this.groups.set(group,pending)
    }
    const runtime = await pending
    const assertOwner = (key:RunKey) => { if(key.requestId!==input.requestId || key.attemptId!==input.attemptId) throw new Error('DSH 请求归属无效。') }
    return { run:async(value,emit)=>{assertOwner(value);if(value!==input)throw new Error('DSH 上下文归属不可替换。');return runtime.run(value,emit)}, cancel:async key=>{assertOwner(key);await runtime.cancel(key)}, flush:async key=>{assertOwner(key);return runtime.flush(key)}, release:()=>runtime.release(input) }
  }
  async close():Promise<void> { const groups=[...this.groups.values()]; this.groups.clear(); await Promise.all(groups.map(async pending=>{try{await (await pending).close()}catch{}})) }
}
