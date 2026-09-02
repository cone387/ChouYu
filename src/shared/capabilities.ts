export type CapabilityKind = 'memory-engine' | 'embedding'

export interface CapabilityInfo {
  id: string
  kind: CapabilityKind
  name: string
  description: string
  installed: boolean
  active: boolean
  networkAccess: boolean
  sendsMemoryData: boolean
  requiresConfiguration: boolean
}
