import type { AIChatMessage } from '../../shared/ai';
import type { AIResponseMetadata } from '../../shared/ai-usage';
import type { AppConfig } from '../../shared/config';
import type { HarnessEngine, HarnessSource, RunKey } from '../../shared/harness';
import type { HarnessToolRuntime } from './tool-runtime';
import type { AIToolCall } from '../../shared/tools';
import type { ContactActionInteraction } from '../../shared/contact-actions';
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
    status: 'running' | 'waiting-user' | 'completed' | 'failed';
    pendingInteraction?: boolean;
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

export interface HarnessCapabilities {
    platforms: 'all' | readonly NodeJS.Platform[];
    scenarios: readonly 'chat'[];
    images: boolean;
    systemHistory: boolean;
    tools: 'host' | readonly string[];
    confirmation: 'return-card' | 'await-receipt';
    recovery: 'none' | 'committed-result';
}
export type HarnessConfirmation = { mode: 'return-card' } | {
    mode: 'await-receipt';
    beforeOffer(call: AIToolCall): Promise<void>;
    waitForReceipt(call: AIToolCall, card: ContactActionInteraction): Promise<string>;
};
export interface HarnessPurgeScope { characterId: string; sessionId?: string; sourceIds?: string[] }
export interface HarnessLifecycle {
    recover?(): Promise<void>;
    purge?(scope: HarnessPurgeScope): Promise<void>;
    acknowledgeSaved?(sessionId: string): Promise<void>;
    close?(): Promise<void>;
}
export interface HarnessModule {
    id: HarnessEngine;
    label: string;
    capabilities: HarnessCapabilities;
    adapter: HarnessAdapter;
    confirmation(input: HarnessInput): HarnessConfirmation;
    lifecycle?: HarnessLifecycle;
}
