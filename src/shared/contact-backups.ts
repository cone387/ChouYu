export interface ContactBackupFile { schema: number; bytes: number; sha256: string }
export const CONTACT_TASK_SCHEMA_VERSION = 20
export interface ContactBackupManifest {
  format: 1
  id: string
  createdAt: number
  files: { tasks: ContactBackupFile; checkpoints: ContactBackupFile }
}
export interface ContactBackupStatus {
  phase: 'idle' | 'waiting' | 'saving' | 'failed'
  lastSuccessAt?: number
  lastAttemptAt?: number
  failures: number
  reason?: 'busy' | 'storage' | 'invalid'
}
