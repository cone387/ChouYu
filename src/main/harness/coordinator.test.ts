import { expect, it, vi } from 'vitest';
import { HarnessCoordinator } from './coordinator';
import type { HarnessInput } from './contracts';
const input = () => ({ requestId: 'r', attemptId: 'a', characterId: 'pilot', signal: new AbortController().signal, assertContext: async () => { } } as HarnessInput);
it('reads persisted per-contact selection on each request without restarting', async () => {
    const selected: Record<string, 'legacy' | 'dsh'> = { pilot: 'dsh', other: 'legacy' };
    const legacy = { run: async () => ({ state: 'completed' as const, text: 'native' }) };
    const dsh = { run: async () => ({ state: 'completed' as const, text: 'dsh' }) };
    const coordinator = new HarnessCoordinator({ legacy, dsh }, id => selected[id] ?? 'legacy', 'win32');
    expect(await coordinator.run(input(), () => {})).toMatchObject({ text: 'dsh' });
    expect(await coordinator.run({ ...input(), characterId: 'other' }, () => {})).toMatchObject({ text: 'native' });
    selected.pilot = 'legacy';
    expect(await coordinator.run(input(), () => {})).toMatchObject({ text: 'native' });
});
it('invalidates durable adapter output rejected by final context validation',async()=>{
    const invalidate=vi.fn(async()=>{});
    const dsh={run:async()=>({state:'completed' as const,text:'stale'}),invalidate};
    const coordinator=new HarnessCoordinator({dsh},id => id === 'pilot' ? 'dsh' : 'legacy','win32');
    const value={...input(),assertContext:async()=>{throw new Error('stale')}};
    expect((await coordinator.run(value,()=>{})).state).toBe('failed');
    expect(invalidate).toHaveBeenCalledWith(value);
});
it('keeps ordinary contacts on legacy and never falls back after a DSH failure', async () => {
    const legacy = { run: vi.fn(async () => ({ state: 'completed' as const, text: 'legacy' })) }, dsh = { run: vi.fn(async () => { throw new Error('dsh failed'); }) };
    const coordinator = new HarnessCoordinator({ legacy, dsh }, id => id === 'pilot' ? 'dsh' : 'legacy', 'win32');
    expect(await coordinator.run({ ...input(), characterId: 'other' }, () => { })).toMatchObject({ state: 'completed' });
    expect(await coordinator.run(input(), () => { })).toMatchObject({ state: 'failed', error: 'dsh failed' });
    expect(legacy.run).toHaveBeenCalledTimes(1);
    expect(dsh.run).toHaveBeenCalledTimes(1);
});
it('does not launch DSH on macOS or before an already cancelled request', async () => {
    const run = vi.fn(), coordinator = new HarnessCoordinator({ dsh: { run } }, id => id === 'pilot' ? 'dsh' : 'legacy', 'darwin');
    expect(await coordinator.run(input(), () => { })).toMatchObject({ state: 'failed' });
    const abort = new AbortController();
    abort.abort();
    expect(await coordinator.run({ ...input(), signal: abort.signal }, () => { })).toMatchObject({ state: 'cancelled' });
    expect(run).not.toHaveBeenCalled();
});
