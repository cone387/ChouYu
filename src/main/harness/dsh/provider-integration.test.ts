import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('runs both provider protocols through real SDK and returns exactly one tool receipt', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [resolve('runtime/dsh/helper.mjs'), '--probe'], { timeout: 90000 })
  const result = JSON.parse(stdout.trim().split('\n').at(-1)!)
  expect(result.passed).toBe(true)
  expect(result.results.map(({ provider, requests, toolExecutions, reply }: {provider:string; requests:number; toolExecutions:number; reply:string}) => ({ provider, requests, toolExecutions, reply }))).toEqual([
    { provider: 'openai', requests: 2, toolExecutions: 1, reply: 'DSH_OK' },
    { provider: 'claude', requests: 2, toolExecutions: 1, reply: 'DSH_OK' }
  ])
}, 100000)
