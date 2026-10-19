import { expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BackgroundLogs } from './background-logs'

it('reopens ownership and deletes only the requested owner and run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'background-log-ownership-'))
  try {
    const group = 'a'.repeat(64), paths: string[] = []
    for (const [characterId, requestId, attemptId] of [['alice', 'one', 'first'], ['alice', 'two', 'second'], ['bob', 'one', 'third']]) {
      new BackgroundLogs(dir).begin({ characterId, requestId, attemptId, runtimeGroup: group })
      const path = join(dir, group, 'sessions', 'project', attemptId)
      mkdirSync(path, { recursive: true }); writeFileSync(join(path, 'session.jsonl'), 'private content'); paths.push(path)
    }
    await new BackgroundLogs(dir).purge({ characterId: 'alice', requestIds: ['one'] })
    expect(paths.map(existsSync)).toEqual([false, true, true])
    await new BackgroundLogs(dir).purge({ characterId: 'alice' })
    expect(paths.map(existsSync)).toEqual([false, false, true])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

it('rejects a redirected ownership directory before writing or deleting its files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'background-log-boundary-'))
  try {
    const home = join(dir, 'home'), outside = join(dir, 'outside')
    mkdirSync(home); mkdirSync(outside)
    symlinkSync(outside, join(home, 'ownership'), 'junction')
    const record = { characterId: 'alice', requestId: 'one', attemptId: 'attempt', runtimeGroup: 'a'.repeat(64) }
    writeFileSync(join(outside, 'attempt.json'), JSON.stringify(record))
    expect(() => new BackgroundLogs(home).begin({ ...record, attemptId: 'new' })).toThrow(/路径/)
    await expect(new BackgroundLogs(home).purge({ characterId: 'alice' })).rejects.toThrow(/路径/)
    expect(existsSync(join(outside, 'attempt.json'))).toBe(true)
    expect(existsSync(join(outside, 'new.json'))).toBe(false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
