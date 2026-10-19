import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { HarnessPurgeScope } from '../contracts'
import { purgeRunLogs } from '../logs'

type BackgroundLog = { characterId: string; requestId: string; attemptId: string; runtimeGroup: string }
/** Only ownership metadata, persisted before the SDK can write request content. */
export class BackgroundLogs {
  private directory: string
  constructor(private home: string) { this.directory = join(home, 'ownership') }
  private checkDirectory() {
    const rel = relative(resolve(this.home), realpathSync(this.directory))
    if (rel.startsWith('..') || isAbsolute(rel) || lstatSync(this.directory).isSymbolicLink()) throw new Error('后台执行日志归属路径越界。')
  }
  begin(value: BackgroundLog) {
    mkdirSync(this.directory, { recursive: true })
    this.checkDirectory()
    const file = join(this.directory, value.attemptId + '.json'), temporary = file + '.tmp'
    const fd = openSync(temporary, 'wx')
    try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(temporary, file)
  }
  async purge(scope: HarnessPurgeScope) {
    if (!existsSync(this.directory)) return
    this.checkDirectory()
    for (const entry of readdirSync(this.directory, { withFileTypes: true })) {
      if (!entry.name.endsWith('.json')) continue
      if (!entry.isFile()) throw new Error('后台执行日志归属文件无效。')
      const file = join(this.directory, entry.name)
      let value: BackgroundLog
      try { value = JSON.parse(readFileSync(file, 'utf8')) as BackgroundLog }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
      if (typeof value.characterId !== 'string' || typeof value.requestId !== 'string' || !/^[a-f0-9]{64}$/.test(value.runtimeGroup) || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.attemptId) || entry.name !== value.attemptId + '.json') throw new Error('后台执行日志归属无效。')
      if (value.characterId !== scope.characterId || scope.requestIds && !scope.requestIds.includes(value.requestId)) continue
      await purgeRunLogs(this.home, { runtimeGroup: value.runtimeGroup, dshSessionId: value.attemptId })
      unlinkSync(file)
    }
  }
}
