import type { HarnessEngine } from '../../shared/harness'
import type { HarnessAdapter, HarnessModule } from './contracts'
import { createNativeModule } from './native'
import { HarnessRegistry } from './registry'

/** Test-only registration for coordinator behaviors, with explicit platform capabilities. */
export function registryFor(adapters: Partial<Record<HarnessEngine, HarnessAdapter>>): HarnessRegistry {
  return new HarnessRegistry(Object.entries(adapters).map(([id, adapter]): HarnessModule => ({
    ...createNativeModule(), id: id as HarnessEngine, adapter,
    capabilities: { ...createNativeModule().capabilities, platforms: id === 'dsh' ? ['win32'] : 'all' }
  })))
}
