import type { AppConfig } from '../../shared/config'
import type { SkillSnapshot } from '../../shared/skills'

export interface ContactIdentity {
  configurationVersions?: { profile?: string; skills?: number; credential?: number }
  sessionIds?: string[]
  skillToolsEnabled?: boolean
  disabledSkillTools?: string[]
  visibleNoticeIds?: string[]
  id: string
  name?: string
  soul: string
  conversation: string
  searchKey?: string
  skills?: SkillSnapshot
  config: Pick<AppConfig, 'provider' | 'baseUrl' | 'apiKey' | 'model' | 'thinkingDisabledModels'> | null
}
export interface ContactModule {
  readonly id: string
  prepare?(): void
  advance?(): boolean
  close(): Promise<void>
}
export interface ContactModuleOwner { readonly id: string; readonly identity: ContactIdentity }
export type ContactModuleFactory = (owner: ContactModuleOwner) => ContactModule
