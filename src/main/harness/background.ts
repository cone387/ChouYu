import { HarnessRegistry } from './registry'
import { createNativeModule } from './native'
import { createDshBackgroundModule } from './dsh/background'
import type { DshRuntimeOptions } from './dsh/runtime'

/** Worker-safe registry: no Electron main-process state or chat session ownership. */
export function createBackgroundHarnesses(dsh?: DshRuntimeOptions) {
  return new HarnessRegistry([createNativeModule(), ...(dsh ? [createDshBackgroundModule(dsh)] : [])])
}
