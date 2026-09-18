import type Database from 'better-sqlite3'
import type { JournalConfig } from '../../shared/journal'

export const CAPTURE_RESERVE_BYTES = 5_000_000
export const DISK_RESERVE_BYTES = 2 * 1024 ** 3
export const CAPTURE_PAUSED_PREFIX = '截图已暂停：'

/** Transactional counters also stay correct on rollback and across worker connections. */
export function initializeCaptureUsage(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS capture_usage (id INTEGER PRIMARY KEY CHECK(id=1), bytes INTEGER NOT NULL);
    INSERT OR IGNORE INTO capture_usage SELECT 1,COALESCE(SUM(bytes),0) FROM captures;
    CREATE TRIGGER IF NOT EXISTS capture_usage_insert AFTER INSERT ON captures BEGIN UPDATE capture_usage SET bytes=bytes+new.bytes WHERE id=1; END;
    CREATE TRIGGER IF NOT EXISTS capture_usage_delete AFTER DELETE ON captures BEGIN UPDATE capture_usage SET bytes=bytes-old.bytes WHERE id=1; END;
    CREATE TRIGGER IF NOT EXISTS capture_usage_update AFTER UPDATE OF bytes ON captures BEGIN UPDATE capture_usage SET bytes=bytes-old.bytes+new.bytes WHERE id=1; END;`)
}

export function captureUsage(db: Database.Database): number {
  return (db.prepare('SELECT bytes FROM capture_usage WHERE id=1').get() as { bytes: number }).bytes
}

export function cleanupTarget(config: JournalConfig, used: number, incoming: number): number | null {
  const limit = config.maxStorageMB * 1024 ** 2
  return limit && used + incoming > limit && config.autoCleanup ? Math.max(0, Math.min(limit * 0.9, limit - incoming)) : null
}

export function capacityNotice(config: JournalConfig, used: number, incoming: number, free: number): string | null {
  if (free - incoming < DISK_RESERVE_BYTES) return `${CAPTURE_PAUSED_PREFIX}磁盘可用空间不足 2 GB；请释放空间，活动记录继续。`
  if (config.maxStorageMB && used + incoming > config.maxStorageMB * 1024 ** 2) return `${CAPTURE_PAUSED_PREFIX}画面存储已达上限；请开启自动清理、删除旧画面或提高上限，活动记录继续。`
  return null
}
