import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const fixture = vi.hoisted(() => ({ directory: '', session: undefined as any, flushError: '', purge: vi.fn(), state: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => fixture.directory, getAppPath: () => process.cwd(), isPackaged: false } }))
vi.mock('../../database', () => ({ getSession: () => fixture.session, flushDatabase: () => ({ error: fixture.flushError }), setState: fixture.state, getState: () => '', saveSessionMessages: vi.fn() }))
vi.mock('../../agents', () => ({ contactAgentsCall: vi.fn(), onContactContextChanged: () => () => {} }))
vi.mock('./runtime', () => ({ DshRuntimePool: class { async close() {} }, resolveDshRuntimePaths: () => ({ node: 'unused', helper: 'unused' }), inspectDshRun: vi.fn(), dshRuntimeGroup: vi.fn() }))
vi.mock('../logs', () => ({ purgeRunLogs: fixture.purge }))
import { dshService, closeDshService, acknowledgeDshMessages } from './service'
import type { HarnessInput } from '../contracts'

const key = { requestId: 'r', attemptId: 'a' }
beforeEach(() => {
  fixture.directory = mkdtempSync(join(tmpdir(), 'native-harness-ack-')); fixture.flushError = ''; vi.resetAllMocks()
  const service = dshService(), run = service.store.begin({ ...key, characterId: 'c', sessionId: 's', snapshotFingerprint: 'f', configVersion: 'v' } as HarnessInput)
  service.store.bindSession(key, 'dsh-session'); service.store.bindInput(key, 'input')
  service.store.transition(key, 'starting', 'running'); service.store.transition(key, 'running', 'completed'); service.store.markDurable(key)
  fixture.session = { id: 's', characterId: 'c', messages: [{ id: run.messageId, role: 'assistant', content: 'saved body', replyCompletedAt: 1, harnessSource: { ...key, engine: 'dsh', version: run.version, messageId: run.messageId } }] }
})
afterEach(async () => { await closeDshService(); rmSync(fixture.directory, { recursive: true, force: true }) })
it('marks and cleans only a flushed matching assistant reply', async () => {
  await acknowledgeDshMessages('s')
  expect(dshService().store.get(key)).toMatchObject({ messageSaved: true, logsPurged: true, cleanupPending: false })
  expect(fixture.purge).toHaveBeenCalledTimes(1)
})
it.each(['session','owner','role','engine','version','message','unfinished','suppressed'] as const)('does not acknowledge a mismatching %s', async mismatch => {
  const message = fixture.session.messages[0]
  if (mismatch === 'session') fixture.session.id = 'other'
  if (mismatch === 'owner') fixture.session.characterId = 'other'
  if (mismatch === 'role') message.role = 'user'
  if (mismatch === 'engine') message.harnessSource.engine = 'native'
  if (mismatch === 'version') message.harnessSource.version = 'wrong'
  if (mismatch === 'message') message.harnessSource.messageId = 'wrong'
  if (mismatch === 'unfinished') delete message.replyCompletedAt
  if (mismatch === 'suppressed') dshService().store.suppressDelivery(key)
  await acknowledgeDshMessages('s')
  expect(dshService().store.get(key)?.messageSaved).toBe(false)
  expect(fixture.purge).not.toHaveBeenCalled()
})
it('retains the recovery record if message flush fails', async () => {
  fixture.flushError = 'disk full'
  await expect(acknowledgeDshMessages('s')).rejects.toThrow('disk full')
  expect(dshService().store.get(key)?.messageSaved).toBe(false)
  expect(fixture.purge).not.toHaveBeenCalled()
})
it('keeps cleanup pending when log removal fails after a saved reply', async () => {
  fixture.purge.mockRejectedValueOnce(new Error('logs locked'))
  await expect(acknowledgeDshMessages('s')).rejects.toThrow('logs locked')
  expect(dshService().store.get(key)).toMatchObject({ messageSaved: true, cleanupPending: true })
  expect(fixture.state).toHaveBeenCalledWith('harness:cleanup-error', expect.any(String))
})
