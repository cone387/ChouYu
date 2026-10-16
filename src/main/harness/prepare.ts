import { createHash, randomUUID } from 'node:crypto';
import type { AIChatMessage, AIStreamRequest } from '../../shared/ai';
import type { ContentCitation } from '../../shared/contact-content';
import type { AppConfig } from '../../shared/config';
import type { HarnessInput } from './contracts';
import type { HarnessToolRuntime } from './tool-runtime';
export interface PreparationContext {
    config: AppConfig;
    signal: AbortSignal;
    assertContext(): Promise<void>;
    citationContext(citations: ContentCitation[]): Promise<string>;
    privateContext: string;
    skillContext: string;
    communication: string;
    tools?: HarnessToolRuntime;
    onMetadata?: HarnessInput['onMetadata'];
}
export async function prepareHarnessInput(request: AIStreamRequest, context: PreparationContext): Promise<HarnessInput> {
    await context.assertContext();
    context.signal.throwIfAborted();
    const snapshot = structuredClone(request);
    const config = structuredClone(context.config);
    const messages: AIChatMessage[] = [];
    const lastUserIndex = snapshot.messages.reduce((last, m, i) => m.role === 'user' ? i : last, -1);
    for (let i = 0; i < snapshot.messages.length; i++) {
        const message = snapshot.messages[i];
        let referenceContext = '';
        if (message.contactCitations?.length) {
            if (!snapshot.characterId)
                throw new Error('请在原联系人的会话中讨论这份成果。');
            try {
                referenceContext = await context.citationContext(message.contactCitations);
            }
            catch (error) {
                if (i === lastUserIndex)
                    throw error;
                referenceContext = '\n（此历史消息引用的正文已移除或无法读取，请勿假定其内容。）';
            }
        }
        messages.push({ ...message, content: message.content + referenceContext });
    }
    const systemPrompt = snapshot.systemPrompt + context.privateContext + context.skillContext + context.communication;
    await context.assertContext();
    return {
        requestId: snapshot.requestId, attemptId: randomUUID(), characterId: snapshot.characterId, sessionId: snapshot.sessionId,
        messages, systemPrompt, config, signal: context.signal, tools: context.tools, assertContext: context.assertContext,
        onMetadata: context.onMetadata,
        snapshotFingerprint: createHash('sha256').update(JSON.stringify({ messages, systemPrompt })).digest('hex'),
        // A one-way revision fingerprint separates runtime initialization after effective config changes.
        configVersion: harnessConfigVersion(config)
    };
}
export function harnessConfigVersion(config: AppConfig): string { return createHash('sha256').update(JSON.stringify([config.provider, config.baseUrl, config.model, config.apiKey, config.soulMd, config.aiToolsEnabled, config.toolPermissionMode])).digest('hex'); }
