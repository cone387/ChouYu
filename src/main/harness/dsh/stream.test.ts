import { expect, it } from 'vitest';
import { DshStreamReducer } from './stream';
it('replaces a failed draft, ignores duplicate frames and records actual attempts with unknown usage', () => {
    const r = new DshStreamReducer();
    let rendered = '';
    const accept = (frame: unknown) => { for (const e of r.accept(frame))
        if (e.type === 'text')
            rendered = e.operation === 'replace' ? e.text : rendered + e.text; };
    accept({ type: 'start', attemptId: 'one', revision: 1, turn: 1, step: 1 });
    accept({ type: 'chunk', attemptId: 'one', revision: 2, index: 0, chunk: { type: 'text-delta', text: 'wrong' } });
    accept({ type: 'end', attemptId: 'one', revision: 3, index: 1, outcome: { kind: 'committed', eventType: 'assistant/attempt', seq: 2 } });
    accept({ type: 'start', attemptId: 'two', revision: 4, turn: 1, step: 1 });
    const chunk = { type: 'chunk', attemptId: 'two', revision: 5, index: 0, chunk: { type: 'text-delta', text: 'right' } };
    accept(chunk);
    accept(chunk);
    const end = { type: 'end', attemptId: 'two', revision: 6, index: 1, outcome: { kind: 'committed', eventType: 'assistant/message', seq: 5 } };
    accept(end);
    accept(end);
    expect(rendered).toBe('right');
    expect(r.calls()).toHaveLength(2);
    expect(r.calls()[0].usage).toBeNull();
    expect(r.verify(5)).toBe(true);
    expect(r.verify(4)).toBe(false);
});
it('fails sequence gaps and cannot certify partial output', () => {
    const r = new DshStreamReducer();
    r.accept({ type: 'start', attemptId: 'a', revision: 1, turn: 1, step: 1 });
    expect(() => r.accept({ type: 'chunk', attemptId: 'a', revision: 2, index: 1, chunk: { type: 'text-delta', text: 'partial' } })).toThrow(/缺口/);
    expect(r.verify(2)).toBe(false);
});
it('counts disjoint cached input and only supplies a terminal finish reason from the provider', () => {
    const r = new DshStreamReducer();
    r.accept({ type: 'start', attemptId: 'a', revision: 1 });
    r.accept({ type: 'chunk', attemptId: 'a', revision: 2, index: 0, chunk: { type: 'usage', usage: { inputTokens: 11, cacheReadTokens: 20, cacheWriteTokens: 3, outputTokens: 7 } } });
    r.accept({ type: 'chunk', attemptId: 'a', revision: 3, index: 1, chunk: { type: 'finish', reason: { kind: 'tool-calls' } } });
    expect(r.accept({ type: 'end', attemptId: 'a', revision: 4, index: 2, outcome: { kind: 'committed', eventType: 'assistant/message', seq: 5 } })).toEqual([
        { type: 'usage', providerRequestId: 'a', metadata: { finishReason: 'tool_calls', usage: { inputTokens: 34, outputTokens: 7, totalTokens: 41, cacheReadTokens: 20, cacheWriteTokens: 3 } } }
    ]);
});
