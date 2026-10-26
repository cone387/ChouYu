import { ContactBackups } from '../storage/contact-backups'
import { ContactRestore, inspectContactStorageForStartup } from '../storage/contact-restore'
import { CONTACT_TASK_SCHEMA_VERSION } from '../../shared/contact-backups'
import type { ContactRuntimeSnapshot } from '../../shared/contact-runtime'
import type { ContactRecoveryGuard } from './recovery-guard'
/** Host composition of paired storage and the independent application guard. */
export class ContactStorageRecovery {
  constructor(private directory: () => string, private guard: ContactRecoveryGuard, private owners: () => string[], private retry: (event: import('../storage/contact-database').StorageRetry) => void = () => {}) {}
  private protocol() {
    return new ContactRestore(this.directory(), (group, restoreId) => this.guard.begin(group, restoreId, this.owners()), undefined,
      (group, restoreId) => { const current = this.guard.current(); if (current?.restoreId !== restoreId || current.group !== group) throw new Error('应用库恢复保护不匹配，未打开联系人数据。') })
  }
  resume() { this.protocol().resume() }
  restore(groupId: string) { this.protocol().restore(groupId) }
  async inspect(): Promise<ContactRuntimeSnapshot['storageRecovery']> {
    const health = await inspectContactStorageForStartup(this.directory(), this.retry)
    if (health.kind === 'healthy' || health.kind === 'new') return
    return { kind: health.kind, candidates: health.kind === 'damaged' || health.kind === 'missing'
      ? new ContactBackups(this.directory()).list().filter(group => group.files.tasks.schema <= CONTACT_TASK_SCHEMA_VERSION && group.files.checkpoints.schema === 0) : [] }
  }
}
