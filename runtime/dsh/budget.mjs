/** Budget the exact admitted input without mutating the SDK's frozen request.
 * A lower host cap is applied through the documented request/config waterfall.
 * The local retry never calls the provider, and must preserve the reserved input.
 */
export function installBudget(scope, peer, key, sessionId, maxTokens) {
    let round = 0, reserved, negotiating = false;
    scope.on('agent/request', async (_payload, next) => ({ ...await next(), maxTokens: reserved?.cap ?? maxTokens }));
    scope.on('agent/request-error', async (_payload, next) => {
        if (!negotiating) return next();
        negotiating = false;
        return { kind: 'retry' };
    });
    scope.on('llm/stream', async function* (options, next) {
        if (options.sessionId !== sessionId) { yield* next(); return; }
        const serializedInput = JSON.stringify({ messages: options.messages, tools: options.tools, toolHistory: options.toolHistory });
        if (!reserved) {
            const result = await peer.request('round:before', { ...key, sessionId, round, serializedInput }, { signal: options.signal });
            const cap = Math.min(maxTokens, result.maxOutputTokens);
            if (!Number.isSafeInteger(cap) || cap < 1) throw new Error('后台输出额度无效。');
            reserved = { cap, serializedInput };
        }
        if (serializedInput !== reserved.serializedInput) throw new Error('DSH 额度确认期间输入已变化，本次未发送。');
        if (options.maxTokens !== reserved.cap) {
            negotiating = true;
            yield { type: 'finish', reason: { kind: 'error', failure: { code: 'CHOUYU_OUTPUT_LIMIT', message: 'Apply the host output limit before dispatch.' } } };
            return;
        }
        let usage, finish;
        try {
            for await (const chunk of next()) {
                if (chunk.type === 'usage') usage = chunk.usage;
                if (chunk.type === 'finish') finish = chunk.reason;
                yield chunk;
            }
        } finally {
            await peer.request('round:after', { ...key, sessionId, round, usage, finish }, { timeoutMs: 15000 });
            reserved = undefined;
            round++;
        }
    });
}
