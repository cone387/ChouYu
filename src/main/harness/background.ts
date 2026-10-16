import { HarnessRegistry } from './registry'
import { createNativeModule } from './native'

/** Worker-safe registry: no Electron main-process state or chat session ownership. */
export const backgroundHarnesses = new HarnessRegistry([createNativeModule()])
