export type HarnessEngine = 'legacy' | 'dsh'
export type RunState = 'starting' | 'running' | 'waiting-user' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export interface RunKey { requestId: string; attemptId: string }
export interface ToolKey extends RunKey { callId: string }
export interface HarnessSource extends RunKey { engine: HarnessEngine; version: string; messageId: string }
