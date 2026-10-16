import { getCharacter } from '../database'
import { createNativeModule } from './native'
import { createDshModule } from './dsh/module'
import { HarnessRegistry } from './registry'
import { HarnessCoordinator } from './coordinator'
import type { HarnessLifecycle, HarnessPurgeScope } from './contracts'

let cancelRun: (requestId: string) => Promise<void> = key => chatHarness.cancel(key)
export function setHarnessCancellation(cancel: typeof cancelRun): void { cancelRun = cancel }
export const harnessRegistry = new HarnessRegistry([createNativeModule(), createDshModule({ cancelRun: key => cancelRun(key) })])
export const chatHarness = new HarnessCoordinator(harnessRegistry, id => getCharacter(id)?.harnessEngine ?? 'native')

async function dispatch(call: (lifecycle: HarnessLifecycle) => Promise<void> | undefined): Promise<void> {
  const results = await Promise.allSettled(harnessRegistry.all().map(async module => {
    if (module.lifecycle) await call(module.lifecycle)
  }))
  const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (errors.length) throw new Error(errors.map(result => result.reason instanceof Error ? result.reason.message : String(result.reason)).join('；'))
}
export function recoverHarnessModules(): Promise<void> { return dispatch(lifecycle => lifecycle.recover?.()) }
export function purgeHarnessData(scope: HarnessPurgeScope): Promise<void> { return dispatch(lifecycle => lifecycle.purge?.(scope)) }
export function acknowledgeHarnessMessages(sessionId: string): Promise<void> { return dispatch(lifecycle => lifecycle.acknowledgeSaved?.(sessionId)) }
export async function closeHarnessModules(): Promise<void> {
  try { await chatHarness.close() } finally { await dispatch(lifecycle => lifecycle.close?.()) }
}
