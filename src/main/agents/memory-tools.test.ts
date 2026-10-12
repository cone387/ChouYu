import { expect, it, vi } from 'vitest'
import { createMemoryTools } from './memory-tools'
import { shouldConfirmTool } from '../../shared/tools'
import type { ToolExecutionContext } from '../tools/registry'
const context = { sessionId: 'chat', mainWindow: {} } as ToolExecutionContext
it('binds corrections to a read owner/revision and follows existing permission policy', async () => {
  let owner = 'alice'
  const memory = { id: 'm', owner, revision: 2, content: 'old', kind: 'preference', scope: { kind: 'contact' }, source: { kind: 'user', at: 1 }, status: 'active' }
  const request = vi.fn(async (method: string) => method === 'memoryList' ? [memory] : memory)
  const tool = createMemoryTools({ owner: () => owner, request }).find(t => t.name === 'update_contact_memory')!
  expect(shouldConfirmTool(tool, 'confirm')).toBe(true)
  expect(shouldConfirmTool(tool, 'full')).toBe(false)
  await expect(tool.prepareAsync!({ id: 'unknown', revision: 2, content: 'new' }, context)).rejects.toThrow()
  await expect(tool.prepareAsync!({ id: 'm', revision: 1, content: 'new' }, context)).rejects.toThrow()
  const prepared = await tool.prepareAsync!({ id: 'm', revision: 2, content: 'new' }, context)
  owner = 'bob'; await expect(prepared.execute()).rejects.toThrow()
  expect(request.mock.calls.every(c => c[0] === 'memoryList')).toBe(true)
  owner = 'alice'; const valid = await tool.prepareAsync!({ id: 'm', revision: 2, content: 'new' }, context)
  await valid.execute(); expect(request).toHaveBeenLastCalledWith('updateMemory', 'alice', ['m', 2, expect.objectContaining({ content: 'new', source: { kind: 'user', at: expect.any(Number) } })])
  await expect(valid.execute()).rejects.toThrow()
})
