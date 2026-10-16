import type { AIChatMessage } from '../../shared/ai';
import type { AIResponseMetadata } from '../../shared/ai-usage';
import type { AppConfig } from '../../shared/config';
import type { HarnessEngine, HarnessSource, RunKey } from '../../shared/harness';
import type { HarnessToolRuntime } from './tool-runtime';
export type { RunKey, ToolKey, RunState } from '../../shared/harness';
export interface HarnessInput extends RunKey {
    characterId?: string;
    sessionId?: string;
    messages: AIChatMessage[];
    systemPrompt: string;
    config: AppConfig;
    snapshotFingerprint: string;
    configVersion: string;
    tools?: HarnessToolRuntime;
    signal: AbortSignal;
    assertContext(): Promise<void>;
    onMetadata?(metadata: AIResponseMetadata): void;
}
export type HarnessResult = {
    state: 'completed';
    text: string;
    source?: HarnessSource;
} | {
    state: 'failed' | 'cancelled' | 'interrupted';
    error: string;
};
export type HarnessUpdate = {
    type: 'started';
    engine: HarnessEngine;
} | {
    type: 'prepared';
    inputMessageId: string;
} | {
    type: 'text';
    text: string;
    operation: 'append' | 'replace';
} | {
    type: 'usage';
    providerRequestId: string;
    metadata: AIResponseMetadata;
} | {
    type: 'tool';
    callId: string;
    status: 'running' | 'waiting-user' | 'completed';
} | {
    type: 'completed';
    text: string;
    source?: HarnessSource;
} | {
    type: 'failed' | 'cancelled' | 'interrupted';
    error: string;
};
export type HarnessEvent = HarnessUpdate & RunKey & {
    seq: number;
};
export type HarnessSink = (event: HarnessUpdate) => void;
export interface HarnessAdapter {
    run(input: HarnessInput, emit: HarnessSink): Promise<HarnessResult>;
    invalidate?(input: HarnessInput): Promise<void>;
}
