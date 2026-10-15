import { afterEach, expect, it, vi } from 'vitest';
import { ActionResults } from './action-results';
import { HarnessStore } from './store';
import type { ContactActionInteraction } from '../../shared/contact-actions';
const key = { requestId: 'r', attemptId: 'a', callId: 'call' };
const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).forEach(f => f()); vi.useRealTimers(); });
function fixture() {
    const store = new HarnessStore(':memory:');
    cleanups.push(() => store.close());
    store.begin({ ...key, characterId: 'c', sessionId: 's', snapshotFingerprint: 'f', configVersion: 'v' } as never);
    store.transition(key, 'starting', 'running');
    let card = { kind: 'action', id: 'card', version: '1', characterId: 'c', status: 'pending', request: { sessionId: 's' } } as ContactActionInteraction;
    const listeners = new Set<(owner: string) => void>();
    const access = { read: vi.fn(async () => card), subscribe: (listener: (owner: string) => void) => { listeners.add(listener); return () => listeners.delete(listener); }, cancel: vi.fn(async () => { }) };
    const bridge = new ActionResults(store, access);
    return { store, bridge, access, set: (value: Partial<ContactActionInteraction>) => { card = { ...card, ...value }; listeners.forEach(f => f('c')); } };
}
it('waits 65000ms without inference and returns only the saved receipt', async () => {
    vi.useFakeTimers();
    const f = fixture(), abort = new AbortController();
    const result = f.bridge.waitForActionReceipt(key, 'card', abort.signal);
    const settled = vi.fn();
    void result.then(settled);
    await vi.advanceTimersByTimeAsync(65000);
    expect(settled).not.toHaveBeenCalled();
    expect(f.store.get(key)!.state).toBe('waiting-user');
    f.set({ status: 'resolved', outcome: { content: 'saved receipt', summary: 'saved' } });
    expect(await result).toBe('saved receipt');
    expect(f.store.tools(key)[0].receiptRef).toBe('card');
    expect(f.access.cancel).not.toHaveBeenCalled();
});
it('rejects changed owner and returns rejection or uncertain saved state without replay', async () => {
    const f = fixture();
    f.set({ characterId: 'other' });
    await expect(f.bridge.waitForActionReceipt(key, 'card', new AbortController().signal)).rejects.toThrow(/归属/);
    f.set({ characterId: 'c', status: 'failed', retryable: false, result: '请核对；禁止重复执行' });
    expect(await f.bridge.waitForActionReceipt(key, 'card', new AbortController().signal)).toContain('禁止重复执行');
    expect(f.access.cancel).not.toHaveBeenCalled();
});
it('explicit cancellation invalidates only this run pending cards', async () => {
    const f = fixture(), abort = new AbortController(), pending = f.bridge.waitForActionReceipt(key, 'card', abort.signal);
    await vi.waitFor(() => expect(f.access.read).toHaveBeenCalled());
    abort.abort();
    await expect(pending).rejects.toThrow();
    await f.bridge.cancelPendingActions(key);
    expect(f.access.cancel).toHaveBeenCalledWith('c', 'card', '1');
});
