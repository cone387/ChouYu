import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DEFAULT_APP_CONFIG } from '../../../shared/config'
import { prepareHarnessInput } from '../prepare'
import { DshRuntimePool } from './runtime'
import { startMockProvider } from './fixtures/mock-provider.mjs'

const cleanups: Array<() => unknown> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

it('runs a fresh scoped session with exact history and only the main-owned tools', async () => {
  const home = mkdtempSync(join(tmpdir(), 'chouyu-dsh-runtime-'))
  const mock = await startMockProvider('openai')
  const pool = new DshRuntimePool({ home, node: process.execPath, helper: resolve('runtime/dsh/helper.mjs') })
  cleanups.push(() => rmSync(home, { recursive: true, force: true }), () => mock.close(), () => pool.close())
  const tools = { definitions: [{ name: 'chouyu_fixture', displayName: 'Fixture', description: 'synthetic tool', risk: 'safe' as const, requiresConfirmation: false, source: 'builtin' as const, inputSchema: { type: 'object' as const, properties: { value: { type: 'string' as const } }, required: ['value'] } }], execute: async () => 'fixture-result' }
  const prepare = (last: string) => prepareHarnessInput({ requestId: last, characterId: 'alice', sessionId: 'chat', systemPrompt: 'Alice persona', messages: [{ role: 'user', content: 'history user' }, { role: 'assistant', content: 'history assistant' }, { role: 'user', content: last }] }, { config: { ...DEFAULT_APP_CONFIG, provider: 'openai', baseUrl: mock.baseUrl, apiKey: 'fixture-key', model: 'custom-model' }, signal: new AbortController().signal, assertContext: async () => {}, citationContext: async () => '', privateContext: '', skillContext: '', communication: '', tools })
  const first = await prepare('current input'), lease = await pool.acquire(first)
  const result = await lease.run(first, () => {})
  expect(result).toMatchObject({ state: 'completed', text: 'DSH_OK' })
  const messages = mock.requests[0].body.messages
  expect(messages.filter((m: {role:string}) => ['user', 'assistant'].includes(m.role)).map((m: {role:string; content:unknown}) => [m.role, m.content])).toEqual([['user', 'history user'], ['assistant', 'history assistant'], ['user', 'current input']])
  expect(mock.requests[0].body.tools.map((t: {function:{name:string}}) => t.function.name)).toEqual(['chouyu_fixture'])
  expect(JSON.stringify(mock.requests[0].body)).toContain('Alice persona')
  expect(await lease.flush(first)).toBe(true)
  lease.release()
  const second = await prepare('edited current'), next = await pool.acquire(second)
  await next.run(second, () => {})
  expect(first.attemptId).not.toBe(second.attemptId)
  expect(JSON.stringify(mock.requests.at(-1)!.body)).not.toContain('current input')
  expect(JSON.stringify(mock.requests.at(-1)!.body)).toContain('edited current')
  next.release()
}, 60000)

it('separates provider groups and contact scopes, and cancelling one keeps its sibling', async () => {
  const home = mkdtempSync(join(tmpdir(), 'chouyu-dsh-concurrent-'))
  const mock = await startMockProvider('openai', { tools: false, holdText: 'hold Alice' })
  const pool = new DshRuntimePool({ home, node: process.execPath, helper: resolve('runtime/dsh/helper.mjs') })
  cleanups.push(() => rmSync(home, { recursive: true, force: true }), () => mock.close(), () => pool.close())
  const abort = new AbortController()
  const prepare = (id:string, model:string, signal:AbortSignal) => prepareHarnessInput({requestId:id, characterId:id, sessionId:id, systemPrompt:`persona ${id}`,messages:[{role:'user',content:id==='Alice'?'hold Alice':`hello ${id}`}]}, {config:{...DEFAULT_APP_CONFIG,provider:'openai',baseUrl:mock.baseUrl,apiKey:'fixture-key',model},signal,assertContext:async()=>{},citationContext:async()=>'',privateContext:'',skillContext:'',communication:'',tools:{definitions:[],execute:async()=>{throw new Error('unexpected tool')}}})
  const a = await prepare('Alice','model-one',abort.signal), b = await prepare('Bob','model-one',new AbortController().signal), c = await prepare('Carol','model-two',new AbortController().signal)
  const [la,lb,lc] = await Promise.all([pool.acquire(a),pool.acquire(b),pool.acquire(c)])
  const pending = la.run(a,()=>{})
  await import('vitest').then(({vi})=>vi.waitFor(()=>expect(mock.requests.some(r=>JSON.stringify(r.body).includes('hold Alice'))).toBe(true)))
  abort.abort()
  expect(await lb.run(b,()=>{})).toMatchObject({state:'completed',text:'DSH_OK'})
  expect(await pending).toMatchObject({state:'cancelled'})
  expect(await lc.run(c,()=>{})).toMatchObject({state:'completed'})
  const bob = mock.requests.find(r=>JSON.stringify(r.body).includes('persona Bob'))!
  expect(JSON.stringify(bob.body)).not.toContain('Alice')
  expect(bob.body.model).toBe('model-one')
  expect(mock.requests.find(r=>JSON.stringify(r.body).includes('persona Carol'))!.body.model).toBe('model-two')
  await expect(lb.run(c,()=>{})).rejects.toThrow(/归属/)
  la.release();lb.release();lc.release()
},60000)
