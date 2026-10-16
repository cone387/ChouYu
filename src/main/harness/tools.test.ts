import { expect, it } from 'vitest';
import { DEFAULT_APP_CONFIG } from '../../shared/config';
import type { AIToolDefinition } from '../../shared/tools';
import type { ToolExecutionEvent } from '../../shared/tools';
import { createChatTools, type ChatToolContext } from './tools';
import { HarnessCoordinator } from './coordinator';
import { HarnessRegistry } from './registry';
import { createNativeModule } from './native';
import type { HarnessInput } from './contracts';
function fixture() {
    const calls: string[] = [], offers: unknown[] = [];
    const definition: AIToolDefinition = { name: 'set_contact_output_preference', displayName: '偏好', description: '偏好', risk: 'write', requiresConfirmation: true, alwaysConfirm: true, source: 'builtin', inputSchema: { type: 'object', properties: {} } };
    let enabled = true;
    const context: ChatToolContext = {
        confirmation: { mode: 'return-card' },
        request: { requestId: 'r', characterId: 'c', sessionId: 's', messages: [], systemPrompt: '' }, owner: 'c',
        signal: new AbortController().signal, cancel() { }, state: { ownMemoryMutation: false, memoryMutationReceipt: '' }, definitions: [definition],
        getDefinition: name => name === definition.name ? definition : undefined,
        getConfig: () => ({ ...DEFAULT_APP_CONFIG, aiToolsEnabled: enabled, toolPermissionMode: 'full' }), isToolEnabled: () => enabled,
        assertContext: async () => { }, contactPolicy: async () => 'inherit',
        prepare: async () => ({ execute: () => { calls.push('write'); return { content: 'saved', summary: 'saved' }; } }),
        offerAction: async (_key, request) => { offers.push(request); return { id: 'card' } as never; }, approve: async () => 'approved', emit() { }
    };
    return { context, calls, offers, disable: () => { enabled = false; } };
}
it.each(['native', 'dsh'] as const)('stops %s writes when coordinator cancellation arrives during the final context check', async id => {
    const f = fixture(), module = { ...createNativeModule(), id };
    f.context.definitions[0].alwaysConfirm = false;
    let checks = 0, entered!: () => void, release!: () => void;
    const validating = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    f.context.assertContext = async () => { if (++checks === 2) { entered(); await gate; } };
    const input: HarnessInput = { requestId: 'r', attemptId: 'a', messages: [], systemPrompt: '', config: f.context.getConfig(), configVersion: 'v', snapshotFingerprint: 'f', signal: f.context.signal, assertContext: async () => {} };
    input.bindTools = run => createChatTools({ ...f.context, signal: run.signal });
    module.adapter = { run: async run => ({ state: 'completed', text: await run.tools!.execute({ id: 'call', name: 'set_contact_output_preference', arguments: '{}' }) }) };
    const coordinator = new HarnessCoordinator(new HarnessRegistry([module]));
    const running = coordinator.run(input, () => {}, id);
    await validating;
    const cancelling = coordinator.cancel(input.requestId);
    release();
    await cancelling;
    expect(await running).toMatchObject({ state: 'cancelled' });
    expect(input.signal.aborted).toBe(false);
    expect(f.calls).toEqual([]);
});
it('rechecks live tool permission after asynchronous context validation', async () => {
    const f = fixture();
    f.context.definitions[0].alwaysConfirm = false;
    let checks = 0;
    f.context.assertContext = async () => { if (++checks === 2) f.disable(); };
    await createChatTools(f.context).execute({ id: 'call', name: 'set_contact_output_preference', arguments: '{}' });
    expect(f.calls).toEqual([]);
});
it('publishes real tool states and distinguishes a pending card from a saved action', async () => {
    const f = fixture(), tools = createChatTools(f.context), events: ToolExecutionEvent[] = [];
    const release = tools.subscribe(event => events.push(event));
    await tools.execute({ id: 'call', name: 'set_contact_output_preference', arguments: '{}' });
    expect(events.map(e => e.status)).toEqual(['requested', 'completed']);
    expect(events.at(-1)?.pendingInteraction).toBe(true);
    expect(f.calls).toEqual([]);
    release();
    f.disable();
    await tools.execute({ id: 'disabled', name: 'set_contact_output_preference', arguments: '{}' });
    expect(events).toHaveLength(2);
});
it('reports permission revocation as an error event without preparing an action', async () => {
    const f = fixture(), tools = createChatTools(f.context), events: ToolExecutionEvent[] = [];
    tools.subscribe(event => events.push(event)); f.disable();
    await tools.execute({ id: 'call', name: 'set_contact_output_preference', arguments: '{}' });
    expect(events.map(e => e.status)).toEqual(['error']);
    expect(f.offers).toEqual([]);
});
it('returns the original persistent card without executing an always-confirm action', async () => {
    const f = fixture(), tools = createChatTools(f.context);
    const result = JSON.parse(await tools.execute({ id: 'call', name: 'set_contact_output_preference', arguments: '{"scope":"contact"}' }));
    expect(result).toMatchObject({ pendingInteraction: true, interactionId: 'card' });
    expect(f.calls).toEqual([]);
    expect(f.offers).toHaveLength(1);
    expect(await tools.execute({ id: 'next', name: 'set_contact_output_preference', arguments: '{}' })).toContain('每次对话请求只能确认一个');
    expect(f.offers).toHaveLength(1);
});
it('awaits the original saved action receipt and never calls the prepared writer', async () => {
    const f = fixture(), order: string[] = [], events: ToolExecutionEvent[] = [];
    f.context.confirmation = { mode: 'await-receipt',
        beforeOffer: async () => { order.push('flush'); },
        waitForReceipt: async (_call, card) => { expect(f.offers).toHaveLength(1); expect(card.id).toBe('card'); order.push('receipt'); return 'saved original receipt'; } };
    const tools = createChatTools(f.context); tools.subscribe(event => events.push(event));
    expect(await tools.execute({ id: 'call', name: 'set_contact_output_preference', arguments: '{}' })).toBe('saved original receipt');
    expect(events.map(event => event.status)).toEqual(['requested', 'completed']);
    expect(order).toEqual(['flush', 'receipt']);
    expect(f.calls).toEqual([]);
    const bad = fixture();
    bad.context.confirmation = { mode: 'await-receipt', waitForReceipt: async () => '', beforeOffer: async () => { throw new Error('flush failed'); } };
    expect(await createChatTools(bad.context).execute({ id: 'call', name: 'set_contact_output_preference', arguments: '{}' })).toContain('flush failed');
    expect(bad.offers).toEqual([]);
});
it('rechecks permissions and context before preparing or executing', async () => {
    const f = fixture(), tools = createChatTools(f.context);
    f.disable();
    expect(await tools.execute({ id: 'call', name: 'set_contact_output_preference', arguments: '{}' })).toContain('禁用');
    expect(f.offers).toHaveLength(0);
    expect(f.calls).toHaveLength(0);
    const changed = fixture();
    changed.context.assertContext = async () => { throw new Error('stale context'); };
    expect(await createChatTools(changed.context).execute({ id: 'call', name: 'set_contact_output_preference', arguments: '{}' })).toContain('stale context');
    expect(changed.calls).toHaveLength(0);
});
it('rejects a repeated configuration tool and a non-contact preference scope', async () => {
    const f = fixture(), tools = createChatTools(f.context);
    const call = { id: 'call', name: 'set_contact_output_preference', arguments: '{"scope":"contact"}' };
    await tools.execute(call, { index: 1, total: 2 });
    expect(await tools.execute(call, { index: 2, total: 2 })).toContain('组合设置步骤不在');
    expect(f.offers).toHaveLength(1);
    const other = fixture();
    expect(await createChatTools(other.context).execute({ ...call, arguments: '{"scope":"task"}' }, { index: 1, total: 2 })).toContain('组合设置步骤不在');
    expect(other.offers).toHaveLength(0);
});
