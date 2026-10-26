import { GraphDrained, RunControl } from '@langchain/langgraph'
import type { StorageLease } from '../agent-space/storage-barrier'

/** invoke() settles only after LangGraph has drained its checkpointer promises. */
export async function invokeDurableGraph(lease: StorageLease, invoke: (control: RunControl, resume: boolean) => Promise<unknown>) {
  let resume = false
  while (true) {
    const control = new RunControl()
    lease.onDrain(() => control.requestDrain('contact-backup'))
    try { await invoke(control, resume); return }
    catch (error) { if (!(error instanceof GraphDrained)) throw error }
    finally { lease.onDrain() }
    await lease.boundary()
    resume = true
  }
}
