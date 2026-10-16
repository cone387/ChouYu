import { registryFor } from './test-utils'
import { expect, it, vi } from 'vitest';
import { HarnessCoordinator } from './coordinator';
import type { HarnessInput } from './contracts';
import type { HarnessEvent, HarnessSink } from './contracts';
import { DEFAULT_APP_CONFIG } from '../../shared/config';
const input = (): HarnessInput => ({ requestId: 'r', attemptId: 'a', characterId: 'pilot', messages: [], systemPrompt: '', config: DEFAULT_APP_CONFIG, configVersion: 'v', snapshotFingerprint: 's', signal: new AbortController().signal, assertContext: async () => { } });
it('keeps the execution error and releases the request when invalidation also fails', async () => {
    const events: HarnessEvent[] = [];
    const native = { run: async () => { throw new Error('execution failed'); }, invalidate: async () => { throw new Error('cleanup failed'); } };
    const coordinator = new HarnessCoordinator(registryFor({ native }));
    expect(await coordinator.run(input(), event => events.push(event))).toMatchObject({ state: 'failed', error: expect.stringContaining('execution failed') });
    expect(events.filter(event => event.type === 'failed')).toHaveLength(1);
    expect(await coordinator.run(input(), () => {})).toMatchObject({ error: expect.stringContaining('execution failed') });
});
it('drops late text and adapter terminal events after cancellation', async () => {
    const events: HarnessEvent[] = [], abort = new AbortController();
    const native = { run: async (_input: HarnessInput, emit: HarnessSink) => {
        emit({ type: 'text', text: 'before', operation: 'append' });
        abort.abort();
        emit({ type: 'text', text: 'late', operation: 'append' });
        emit({ type: 'completed', text: 'fake terminal' });
        return { state: 'completed' as const, text: 'late' };
    } };
    const result = await new HarnessCoordinator(registryFor({ native })).run({ ...input(), signal: abort.signal }, event => events.push(event));
    expect(result.state).toBe('cancelled');
    expect(events.filter(event => event.type === 'text').map(event => event.text)).toEqual(['before']);
    expect(events.filter(event => ['completed','failed','cancelled','interrupted'].includes(event.type)).map(event => event.type)).toEqual(['cancelled']);
});
it('reads persisted per-contact selection on each request without restarting', async () => {
    const selected: Record<string, 'native' | 'dsh'> = { pilot: 'dsh', other: 'native' };
    const native = { run: async () => ({ state: 'completed' as const, text: 'native' }) };
    const dsh = { run: async () => ({ state: 'completed' as const, text: 'dsh' }) };
    const coordinator = new HarnessCoordinator(registryFor({ native, dsh }), id => selected[id] ?? 'native', 'win32');
    expect(await coordinator.run(input(), () => {})).toMatchObject({ text: 'dsh' });
    expect(await coordinator.run({ ...input(), characterId: 'other' }, () => {})).toMatchObject({ text: 'native' });
    selected.pilot = 'native';
    expect(await coordinator.run(input(), () => {})).toMatchObject({ text: 'native' });
});
it('invalidates durable adapter output rejected by final context validation',async()=>{
    const invalidate=vi.fn(async()=>{});
    const dsh={run:async()=>({state:'completed' as const,text:'stale'}),invalidate};
    const coordinator=new HarnessCoordinator(registryFor({dsh}),id => id === 'pilot' ? 'dsh' : 'native','win32');
    const value={...input(),assertContext:async()=>{throw new Error('stale')}};
    expect((await coordinator.run(value,()=>{})).state).toBe('failed');
    expect(invalidate).toHaveBeenCalledWith(value);
});
it('keeps ordinary contacts on native and never falls back after a DSH failure', async () => {
    const native = { run: vi.fn(async () => ({ state: 'completed' as const, text: 'native' })) }, dsh = { run: vi.fn(async () => { throw new Error('dsh failed'); }) };
    const coordinator = new HarnessCoordinator(registryFor({ native, dsh }), id => id === 'pilot' ? 'dsh' : 'native', 'win32');
    expect(await coordinator.run({ ...input(), characterId: 'other' }, () => { })).toMatchObject({ state: 'completed' });
    expect(await coordinator.run(input(), () => { })).toMatchObject({ state: 'failed', error: 'dsh failed' });
    expect(native.run).toHaveBeenCalledTimes(1);
    expect(dsh.run).toHaveBeenCalledTimes(1);
});
it('does not launch DSH on macOS or before an already cancelled request', async () => {
    const run = vi.fn(), coordinator = new HarnessCoordinator(registryFor({ dsh: { run } }), id => id === 'pilot' ? 'dsh' : 'native', 'darwin');
    expect(await coordinator.run(input(), () => { })).toMatchObject({ state: 'failed' });
    const abort = new AbortController();
    abort.abort();
    expect(await coordinator.run({ ...input(), signal: abort.signal }, () => { })).toMatchObject({ state: 'cancelled' });
    expect(run).not.toHaveBeenCalled();
});
