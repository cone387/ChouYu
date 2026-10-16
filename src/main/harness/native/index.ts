import { streamNativeChat } from './runner';
import type { HarnessAdapter, HarnessModule } from '../contracts';
export function createNativeModule(): HarnessModule {
    return {
        id: 'native', label: 'ChouYu 原生',
        capabilities: { platforms: 'all', scenarios: ['chat'], images: true, systemHistory: true, tools: 'host', confirmation: 'return-card', recovery: 'none' },
        adapter: createNativeAdapter(), confirmation: () => ({ mode: 'return-card' }),
        background: { run: input => streamNativeChat(input.messages, input.systemPrompt, input.config, input.onChunk, input.signal, input.tools, input.options) }
    };
}
export function createNativeAdapter(model: typeof streamNativeChat = streamNativeChat): HarnessAdapter {
    return {
        async run(input, emit) {
            let text = '', round = 0;
            await model(input.messages, input.systemPrompt, input.config, (chunk) => {
                input.signal.throwIfAborted();
                if (chunk) {
                    text += chunk;
                    emit({ type: 'text', text: chunk, operation: 'append' });
                }
            }, input.signal, input.tools, {
                beforeRound: async () => { await input.assertContext(); input.signal.throwIfAborted(); round++; return undefined; },
                onMetadata: metadata => { input.onMetadata?.(metadata); emit({ type: 'usage', providerRequestId: `${input.attemptId}:${round}`, metadata }); }
            });
            input.signal.throwIfAborted();
            await input.assertContext();
            return { state: 'completed', text };
        }
    };
}
