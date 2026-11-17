import type { ReminderItem } from '../../shared/reminder-followups'
const versions = new Map<string, number>()
export function reminderSourcesChanged(owner: string): void { versions.set(owner, (versions.get(owner) ?? 0) + 1) }
export function reminderSourceVersion(item: ReminderItem): number {
  return (versions.get(item.owner) ?? 0) + (item.source.kind === 'todo' ? versions.get('@todo') ?? 0 : 0)
}
