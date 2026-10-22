import { expect, it } from 'vitest'
import { createMaterialTools } from './material-tools'
import { MaterialReferenceError, withMaterialReferenceRepair } from './material-reference-repair'
import type { ToolExecutionContext } from '../tools/registry'

it('returns one invalid-reference result to the model, then reads only the supplied version', async () => {
  const read: string[] = []
  const tools = createMaterialTools({ owner: () => 'alice', dispatchUnknown: async (method, _owner, args) => {
    if (method === 'materialList') return [{ id: 'allowed', version: 2 }]
    const ref = args[1] as { id: string; version: number }
    if (ref.id !== 'allowed' || ref.version !== 2) throw new MaterialReferenceError()
    read.push(ref.id); return { text: '真实资料', ref }
  } })
  const execute = withMaterialReferenceRepair(async (args: Record<string, unknown>) =>
    (await tools[1].execute(args, {} as ToolExecutionContext)).content)
  expect(JSON.parse(await execute({ id: 'foreign', version: 1 })).error.code).toBe('material-reference')
  expect(read).toEqual([])
  expect(JSON.parse(await execute({ id: 'allowed', version: 2 })).materialRead).toMatchObject({ id: 'allowed', version: 2 })
  expect(read).toEqual(['allowed'])
  await expect(execute({ id: 'allowed', version: 1 })).rejects.toThrow('资料不在本轮目录快照')
})
it('does not swallow cancellation, withdrawal, storage or quota errors', async () => {
  for (const message of ['已取消', '资料已撤回', 'SQLITE_FULL', 'Token 额度不足']) {
    const execute = withMaterialReferenceRepair(async () => { throw new Error(message) })
    await expect(execute()).rejects.toThrow(message)
  }
})
