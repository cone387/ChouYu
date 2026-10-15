import { expect, it } from 'vitest';
import { DEFAULT_APP_CONFIG } from '../../shared/config';
import { createLegacyAdapter } from './legacy';
import { prepareHarnessInput } from './prepare';
import { HarnessCoordinator } from './coordinator';
import type { HarnessEvent } from './contracts';
const prepare = () => prepareHarnessInput({ requestId: 'r', characterId: 'c', sessionId: 's', systemPrompt: 'persona', messages: [{ role: 'user', content: 'hello' }] }, { config: DEFAULT_APP_CONFIG, privateContext: '', skillContext: '', communication: ' rules', assertContext: async () => { }, signal: new AbortController().signal, citationContext: async () => '' });
it('preserves the original model boundary and produces a single terminal result', async () => {
    const input = await prepare(), events: HarnessEvent[] = [];
    const adapter = createLegacyAdapter(async (messages, prompt, config, chunk, signal, tools, options) => {
        expect(messages).toEqual([{ role: 'user', content: 'hello' }]);
        expect(prompt).toBe('persona rules');
        expect(config.model).toBe(input.config.model);
        expect(signal?.aborted).toBe(false);
        expect(tools).toBeUndefined();
        await options?.beforeRound?.(0, '');
        chunk('one', false);
        chunk('two', false);
        chunk('', true);
    });
    const result = await new HarnessCoordinator({ legacy: adapter }, {}).run(input, e => events.push(e));
    expect(result).toMatchObject({ state: 'completed', text: 'onetwo' });
    expect(events.filter(e => e.type === 'completed')).toHaveLength(1);
    expect(events.map(e => e.seq)).toEqual(events.map((_, i) => i + 1));
});
it('does not call legacy when a selected DSH adapter is unavailable', async () => {
    let calls = 0;
    const adapter = createLegacyAdapter(async () => { calls++; });
    const result = await new HarnessCoordinator({ legacy: adapter }, { CHOUYU_DSH_PILOT_CHARACTER_ID: 'c' }).run(await prepare(), () => { });
    expect(result.state).toBe('failed');
    expect(calls).toBe(0);
});
it('does not turn cancellation or failed context verification into completion', async () => {
    const input = await prepare(), controller = new AbortController();
    input.signal = controller.signal;
    const events: HarnessEvent[] = [];
    const adapter = createLegacyAdapter(async (_m, _p, _c, chunk) => { chunk('partial', false); controller.abort(); });
    const result = await new HarnessCoordinator({ legacy: adapter }, {}).run(input, e => events.push(e));
    expect(result.state).toBe('cancelled');
    expect(events.some(e => e.type === 'completed')).toBe(false);
});
