import fs from 'fs'
import { randomUUID } from 'crypto'

export interface StoreFileResult<T> {
  data?: T
  notice: string | null
  blocked: boolean
}

/** Corrupt files are preserved before recovery; read/permission failures never allow overwriting. */
export function readStoreFile<T>(filename: string, parse: (text: string) => T): StoreFileResult<T> {
  let damaged = false
  try {
    for (const candidate of [filename, `${filename}.bak`]) {
      let text: string
      try {
        text = fs.readFileSync(candidate, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      let data: T
      try {
        data = parse(text)
      } catch (error) {
        // A newer format must be opened by its owning application version.
        if (error instanceof Error && error.message === 'NEWER_STORE_VERSION') throw error
        fs.renameSync(candidate, `${candidate}.corrupt-${Date.now()}-${randomUUID()}`)
        damaged = true
        continue
      }
      return {
        data,
        notice: candidate !== filename
          ? `已从上一次备份恢复聊天数据，最近一次保存的修改可能不在备份中。${damaged ? '原有损坏文件已保留。' : '原数据文件缺失。'}`
          : null,
        blocked: false
      }
    }
    return {
      notice: damaged ? '聊天数据无法读取，已保留损坏文件并创建空白工作区。可在数据目录中找回原文件。' : null,
      blocked: false
    }
  } catch {
    return { notice: null, blocked: true }
  }
}

function writeDurably(filename: string, contents: string): void {
  const descriptor = fs.openSync(filename, 'w')
  try {
    fs.writeFileSync(descriptor, contents, 'utf8')
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
}

/** Commit a complete snapshot and keep the previous valid snapshot for recovery. */
export function writeStoreFile(filename: string, contents: string, validate: (text: string) => unknown): void {
  const temporary = `${filename}.tmp`
  writeDurably(temporary, contents)
  let previous: string | undefined
  try {
    previous = fs.readFileSync(filename, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (previous !== undefined && previous !== contents) {
    // Refuse to overwrite a file changed to invalid data while the app was running.
    validate(previous)
    const backupTemporary = `${filename}.bak.tmp`
    writeDurably(backupTemporary, previous)
    fs.renameSync(backupTemporary, `${filename}.bak`)
  }
  fs.renameSync(temporary, filename)
}
