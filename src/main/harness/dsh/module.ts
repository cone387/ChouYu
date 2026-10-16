import type { HarnessModule } from '../contracts'
import { dshService, existingDshService, assertDshRecovered, recoverDshService, purgeDshData, acknowledgeDshMessages, closeDshService } from './service'

export function createDshModule(host: { cancelRun(requestId: string): Promise<void> }): HarnessModule {
  return {
    id: 'dsh', label: 'DeepSeek Harness',
    capabilities: { platforms: ['win32'], scenarios: ['chat'], images: false, systemHistory: false,
      tools: ['read_contact_material', 'get_contact_output_preferences', 'set_contact_output_preference'], confirmation: 'await-receipt', recovery: 'committed-result' },
    adapter: {
      run: (input, emit) => { assertDshRecovered(); return dshService().adapter.run(input, emit) },
      invalidate: async input => { await existingDshService()?.adapter.invalidate(input) }
    },
    confirmation: input => ({
      mode: 'await-receipt',
      beforeOffer: call => dshService().adapter.beforePersistentOffer({ ...input, callId: call.id }),
      waitForReceipt: (call, card) => dshService().actions.waitForActionReceipt({ ...input, callId: call.id }, card.id, input.signal)
    }),
    lifecycle: {
      recover: recoverDshService,
      purge: async scope => { await purgeDshData(scope, host.cancelRun) },
      acknowledgeSaved: acknowledgeDshMessages,
      close: closeDshService
    }
  }
}
