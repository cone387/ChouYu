import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { DEFAULT_APP_CONFIG } from '../../shared/config';
import { prepareHarnessInput } from './prepare';
import { HarnessStore } from './store';
import Database from 'better-sqlite3';
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse())
    cleanup(); });
async function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'chouyu-harness-ledger-')), path = join(dir, 'ledger.sqlite');
    const store = new HarnessStore(path);
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }), () => store.close());
    const input = await prepareHarnessInput({ requestId: 'r', characterId: 'c', sessionId: 's', systemPrompt: 'private-persona', messages: [{ role: 'user', content: 'private-body' }] }, { config: { ...DEFAULT_APP_CONFIG, apiKey: 'secret-fixture-key' }, signal: new AbortController().signal, assertContext: async () => { }, citationContext: async () => '', privateContext: '', skillContext: '', communication: '' });
    return { store, input, path };
}
it('scopes reused call ids and refuses replacement of an existing interaction binding', async () => {
    const { store, input } = await fixture();
    store.begin(input);
    const second = { ...input, requestId: 'other', attemptId: 'other-attempt' };
    store.begin(second);
    store.linkTool({ ...input, callId: 'same-call' }, 'first-card');
    store.linkTool({ ...second, callId: 'same-call' }, 'second-card');
    expect(store.tools(input).map(t => t.interactionId)).toEqual(['first-card']);
    expect(store.tools(second).map(t => t.interactionId)).toEqual(['second-card']);
    expect(() => store.linkTool({ ...input, callId: 'same-call' }, 'different-card')).toThrow(/关联/);
});
it('does not reopen terminal execution and preserves a stable reply identity', async () => {
    const { store, input } = await fixture();
    const record = store.begin(input);
    expect(store.begin(input).messageId).toBe(record.messageId);
    expect(store.transition(input, 'starting', 'running')).toBe(true);
    expect(store.transition(input, 'running', 'completed')).toBe(true);
    expect(store.transition(input, 'completed', 'running')).toBe(false);
    expect(store.transition(input, 'running', 'completed')).toBe(false);
    expect(() => store.begin({ ...input, characterId: 'foreign' })).toThrow(/关联/);
});
it('persists receipts and flush barriers independently without storing credentials or body', async () => {
    const { store, input, path } = await fixture();
    store.begin(input);
    store.bindSession(input, 'dsh-session');
    expect(store.get(input)?.durable).toBe(false);
    store.markDurable(input);
    const tool = { ...input, callId: 'write' };
    store.linkTool(tool, 'card');
    store.markToolStarted(tool);
    store.recordReceipt(tool, 'receipt');
    const reopened = new HarnessStore(path);
    cleanups.push(() => reopened.close());
    expect(reopened.get(input)).toMatchObject({ durable: true, dshSessionId: 'dsh-session' });
    expect(reopened.tools(input)).toMatchObject([{ executionStarted: true, receiptRef: 'receipt' }]);
    expect(() => reopened.recordReceipt(tool, 'other')).toThrow(/回执/);
    for (const secret of ['private-body', 'private-persona', 'secret-fixture-key']) {
        expect(JSON.stringify(reopened.get(input))).not.toContain(secret);
        expect(readFileSync(path).includes(Buffer.from(secret))).toBe(false);
    }
});
it('rejects tool associations for a run that was never durably begun', async () => {
    const { store, input } = await fixture();
    expect(() => store.linkTool({ ...input, callId: 'write' }, 'card')).toThrow();
    expect(store.listUnsettled()).toEqual([]);
});
it('retains a started marker when receipt persistence fails and does not invent a receipt', async () => {
    const { store, input, path } = await fixture();
    store.begin(input);
    const tool = { ...input, callId: 'write' };
    store.linkTool(tool, 'card');
    store.markToolStarted(tool);
    const fault = new Database(path);
    cleanups.push(() => fault.close());
    fault.exec("CREATE TRIGGER reject_receipt BEFORE UPDATE ON tools BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END");
    expect(() => store.recordReceipt(tool, 'receipt')).toThrow('injected receipt failure');
    const reopened = new HarnessStore(path);
    cleanups.push(() => reopened.close());
    expect(reopened.tools(input)).toMatchObject([{ executionStarted: true }]);
    expect(reopened.tools(input)[0].receiptRef).toBeUndefined();
    fault.exec('DROP TRIGGER reject_receipt');
    store.recordReceipt(tool, 'receipt');
    expect(reopened.tools(input)[0].receiptRef).toBe('receipt');
});
