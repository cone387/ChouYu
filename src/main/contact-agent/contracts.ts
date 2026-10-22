import type { AppConfig } from '../../shared/config'
import type { SkillSnapshot } from '../../shared/skills'
import type { HarnessEngine } from '../../shared/harness'
import type { HarnessInput, HarnessEvent, HarnessResult } from '../harness/contracts'

export interface ContactIdentity {
  /** Authoritative application module state carried into worker reconstruction. */
  workLoopEnabled?: boolean
  backgroundHarnessEngine?: HarnessEngine
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
  readonly chat?: ContactChatPort
  readonly work?: ContactWorkPort
  prepare?(): void
  advance?(): boolean
  close(): Promise<void>
}
export interface ContactChatPort {
  run(input: HarnessInput, output: (event: HarnessEvent) => void, engine?: HarnessEngine): Promise<HarnessResult>
  cancel(requestId: string): Promise<void>
}
export interface ContactWorkPort { request<M extends import('../../shared/contact-commands').ContactCommandName>(method: M, args: import('../../shared/contact-commands').ContactArgs<M>): Promise<import('../../shared/contact-commands').ContactResult<M>> }
export interface ContactModuleOwner { readonly id: string; readonly identity: ContactIdentity }
export type ContactModuleFactory = (owner: ContactModuleOwner) => ContactModule
