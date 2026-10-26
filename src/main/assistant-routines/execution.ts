import type { AssistantExecution, AssistantExecutionSnapshot } from '../../shared/assistant-routines'
/** Only live executor leases appear here; persisted history cannot create a live lease. */
export class AssistantExecutions {
  private live = new Map<string, AssistantExecution>()
  constructor(private changed?: () => void) {}
  private notify() { try { this.changed?.() } catch { /* Observers cannot change execution outcome. */ } }
  begin(value: AssistantExecution): void { this.live.set(value.executionId, { ...value }); this.notify() }
  phase(executionId: string, phase: AssistantExecution['phase']): void {
    const value = this.live.get(executionId)
    if (value && value.phase !== phase) { value.phase = phase; this.notify() }
  }
  end(executionId: string): void { if (this.live.delete(executionId)) this.notify() }
  snapshot(): AssistantExecutionSnapshot { return { observedAt: Date.now(), executions: [...this.live.values()].map(value => ({ ...value })) } }
}
