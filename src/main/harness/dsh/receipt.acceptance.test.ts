import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { DshRuntimePool } from './runtime';
import { startMockProvider } from './fixtures/mock-provider.mjs';
import { DEFAULT_APP_CONFIG } from '../../../shared/config';
import { prepareHarnessInput } from '../prepare';
it.skipIf(process.env.CHOUYU_DSH_RECEIPT_ACCEPTANCE !== '1')('keeps a real SDK tool pending for 65 seconds with no extra inference', async () => {
    const home = mkdtempSync(join(tmpdir(), 'chouyu-dsh-receipt-')), mock = await startMockProvider('openai');
    const pool = new DshRuntimePool({ home, node: process.execPath, helper: resolve('runtime/dsh/helper.mjs') });
    let release!: () => void, called!: () => void, writes = 0;
    const waiting = new Promise<void>(r => { called = r; }), receipt = new Promise<void>(r => { release = r; });
    try {
        const input = await prepareHarnessInput({ requestId: 'receipt', characterId: 'c', sessionId: 's', systemPrompt: 'Synthetic contact', messages: [{ role: 'user', content: 'use the fixture' }] }, { config: { ...DEFAULT_APP_CONFIG, provider: 'openai', baseUrl: mock.baseUrl, apiKey: 'fixture-key', model: 'fixture' }, signal: new AbortController().signal, assertContext: async () => { }, citationContext: async () => '', privateContext: '', skillContext: '', communication: '', tools: { definitions: [{ name: 'chouyu_fixture', description: 'fixture', displayName: 'fixture', risk: 'write', requiresConfirmation: true, source: 'builtin', inputSchema: { type: 'object', properties: { value: { type: 'string' } } } }], execute: async () => { called(); await receipt; return 'original saved receipt'; } } });
        const lease = await pool.acquire(input), result = lease.run(input, () => { });
        await waiting;
        await new Promise(r => setTimeout(r, 65000));
        expect(mock.requests).toHaveLength(1);
        expect(writes).toBe(0);
        writes++;
        release();
        expect(await result).toMatchObject({ state: 'completed', text: 'DSH_OK' });
        expect(writes).toBe(1);
        expect(JSON.stringify(mock.requests[1].body)).toContain('original saved receipt');
        lease.release();
    }
    finally {
        release?.();
        await pool.close();
        await mock.close();
        rmSync(home, { recursive: true, force: true });
    }
}, 90000);
