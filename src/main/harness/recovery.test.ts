import { afterEach, expect, it, vi } from 'vitest';
import { HarnessStore } from './store';
import { recoverHarnessRuns, purgeHarnessRuns } from './recovery';
const stores: HarnessStore[] = [];
afterEach(() => stores.splice(0).forEach(s => s.close()));
it.each(['starting', 'running', 'persistent-card', 'ephemeral-confirmation', 'write-started', 'receipt-saved', 'committed'])('reconciles %s without model or tool replay', async (stage) => {
    const store = new HarnessStore(':memory:');
    stores.push(store);
    const key = { requestId: 'r', attemptId: 'a' };
    store.begin({ ...key, characterId: 'c', sessionId: 's', snapshotFingerprint: 'f', configVersion: 'v' } as never);
    if (stage !== 'starting')
        store.transition(key, 'starting', 'running');
    if (['persistent-card', 'write-started', 'receipt-saved'].includes(stage))
        store.linkTool({ ...key, callId: 'call' }, 'card');
    if (stage === 'write-started')
        store.markToolStarted({ ...key, callId: 'call' });
    if (stage === 'receipt-saved')
        store.recordReceipt({ ...key, callId: 'call' }, 'card');
    const messages = new Set<string>(), save = vi.fn(async (run) => { messages.add(run.messageId); });
    const access = { readCommitted: vi.fn(async () => stage === 'committed' ? 'saved text' : undefined), hasMessage: async (run: any) => messages.has(run.messageId), save, purge: async () => { } };
    await recoverHarnessRuns(store, access);
    await recoverHarnessRuns(store, access);
    expect(store.get(key)!.state).toBe(stage === 'committed' ? 'completed' : 'interrupted');
    expect(save).toHaveBeenCalledTimes(stage === 'committed' ? 1 : 0);
    if (stage === 'receipt-saved')
        expect(store.tools(key)[0].receiptRef).toBe('card');
    if (stage === 'write-started')
        expect(store.tools(key)[0].executionStarted).toBe(true);
    // Services deliberately expose neither model dispatch nor business execution.
});
it('keeps cleanup failure visible and scopes cancellation before deletion', async () => {
    const store = new HarnessStore(':memory:');
    stores.push(store);
    const key = { requestId: 'r', attemptId: 'a' };
    store.begin({ ...key, characterId: 'c', sessionId: 's', snapshotFingerprint: 'f', configVersion: 'v' } as never);
    const order: string[] = [];
    const result = await purgeHarnessRuns(store, { characterId: 'c', sessionId: 's' }, { cancel: async () => { order.push('cancel'); }, purge: async () => { order.push('purge'); throw new Error('locked'); } });
    expect(order).toEqual(['cancel', 'purge']);
    expect(result).toEqual({ ok: false, pendingRunIds: ['a'] });
    expect(store.get(key)!.cleanupPending).toBe(true);
});
