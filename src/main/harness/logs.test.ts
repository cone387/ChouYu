import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, existsSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { purgeRunLogs } from './logs'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
const group = 'a'.repeat(64)
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'chouyu-log-alias-')); directories.push(directory)
  const real = join(directory, 'real'); mkdirSync(real)
  const alias = join(directory, 'alias'); symlinkSync(real, alias, 'junction')
  const root = join(alias, 'logs'), target = join(root, group, 'sessions', 'project', 'owned')
  mkdirSync(target, { recursive: true }); writeFileSync(join(target, 'data.jsonl'), '{}')
  return { directory, root, target }
}
it('compares canonical paths when a trusted root has an aliased ancestor', async () => {
  const { root, target } = fixture()
  const peer = join(root, group, 'sessions', 'project', 'peer'); mkdirSync(peer)
  await purgeRunLogs(root, { runtimeGroup: group, dshSessionId: 'owned' })
  expect(existsSync(target)).toBe(false)
  expect(existsSync(peer)).toBe(true)
})
it('still refuses a session junction escaping the canonical root', async () => {
  const { directory, root } = fixture(), outside = join(directory, 'outside'); mkdirSync(outside)
  writeFileSync(join(outside, 'retained'), 'keep')
  symlinkSync(outside, join(root, group, 'sessions', 'project', 'escape'), 'junction')
  await expect(purgeRunLogs(root, { runtimeGroup: group, dshSessionId: 'escape' })).rejects.toThrow('越界')
  expect(existsSync(join(outside, 'retained'))).toBe(true)
})
