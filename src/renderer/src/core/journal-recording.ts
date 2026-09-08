import type { JournalConfig } from '../../../shared/journal'

/** A paused switch does not discard recording preferences or existing evidence. */
export function recordingTogglePatch(config: Pick<JournalConfig, 'enabled' | 'paused'>): Partial<JournalConfig> {
  return config.enabled && !config.paused ? { paused: true } : { enabled: true, paused: false }
}
