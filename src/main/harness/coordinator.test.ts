import { expect, it, vi } from 'vitest';
import { HarnessCoordinator } from './coordinator';
import type { HarnessInput } from './contracts';
const input = () => ({ requestId: 'r', attemptId: 'a', characterId: 'pilot', signal: new AbortController().signal, assertContext: async () => { } } as HarnessInput);
it('reads persisted per-contact selection on each request without restarting', async () => {
    const selected: Record<string, 'native' | 'dsh'> = { pilot: 'dsh', other: 'native' };
    const native = { run: async () => ({ state: 'completed' as const, text: 'native' }) };
    const dsh = { run: async () => ({ state: 'completed' as const, text: 'dsh' }) };
    const coordinator = new HarnessCoordinator({ native, dsh }, id => selected[id] ?? 'native', 'win32');
    expect(await coordinator.run(input(), () => {})).toMatchObject({ text: 'dsh' });
    expect(await coordinator.run({ ...input(), characterId: 'other' }, () => {})).toMatchObject({ text: 'native' });
    selected.pilot = 'native';
    expect(await coordinator.run(input(), () => {})).toMatchObject({ text: 'native' });
});
it('invalidates durable adapter output rejected by final context validation',async()=>{
    const invalidate=vi.fn(async()=>{});
    const dsh={run:async()=>({state:'completed' as const,text:'stale'}),invalidate};
    const coordinator=new HarnessCoordinator({dsh},id => id === 'pilot' ? 'dsh' : 'native','win32');
    const value={...input(),assertContext:async()=>{throw new Error('stale')}};
    expect((await coordinator.run(value,()=>{})).state).toBe('failed');
    expect(invalidate).toHaveBeenCalledWith(value);
});
it('keeps ordinary contacts on native and never falls back after a DSH failure', async () => {
    const native = { run: vi.fn(async () => ({ state: 'completed' as const, text: 'native' })) }, dsh = { run: vi.fn(async () => { throw new Error('dsh failed'); }) };
    const coordinator = new HarnessCoordinator({ native, dsh }, id => id === 'pilot' ? 'dsh' : 'native', 'win32');
    expect(await coordinator.run({ ...input(), characterId: 'other' }, () => { })).toMatchObject({ state: 'completed' });
    expect(await coordinator.run(input(), () => { })).toMatchObject({ state: 'failed', error: 'dsh failed' });
    expect(native.run).toHaveBeenCalledTimes(1);
    expect(dsh.run).toHaveBeenCalledTimes(1);
});
it('does not launch DSH on macOS or before an already cancelled request', async () => {
    const run = vi.fn(), coordinator = new HarnessCoordinator({ dsh: { run } }, id => id === 'pilot' ? 'dsh' : 'native', 'darwin');
    expect(await coordinator.run(input(), () => { })).toMatchObject({ state: 'failed' });
    const abort = new AbortController();
    abort.abort();
    expect(await coordinator.run({ ...input(), signal: abort.signal }, () => { })).toMatchObject({ state: 'cancelled' });
    expect(run).not.toHaveBeenCalled();
});
