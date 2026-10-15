export type HarnessEngine = 'legacy' | 'dsh'
export type RunState = 'starting' | 'running' | 'waiting-user' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export interface RunKey { requestId: string; attemptId: string }
export interface ToolKey extends RunKey { callId: string }
export interface HarnessSource extends RunKey { engine: HarnessEngine; version: string; messageId: string }

/** Data-only bridge payloads. Credentials and main-process callbacks never cross this API. */
export type DshRunCommand = RunKey & {sessionId:string} & (
  | {method:'prepare';history:Array<{role:'user'|'assistant'|'system';content:string}>;systemPrompt:string;tools:unknown[];model:string}
  | {method:'run';prompt:string}
  | {method:'cancel'|'flush'|'dispose'}
)
export type DshRunEvent = RunKey & {sessionId:string} & (
  | {method:'tool';callId:string;name:string;args:unknown}
  | {method:'stream';frame:unknown}
)
