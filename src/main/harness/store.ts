import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { HarnessInput, RunKey, RunState, ToolKey } from './contracts';
export interface RunRecord extends RunKey {
    characterId: string;
    sessionId: string;
    engine: 'dsh';
    version: '0.2.1-alpha.3';
    snapshotFingerprint: string;
    configVersion: string;
    dshSessionId?: string;
    inputMessageId?: string;
    runtimeGroup?: string;
    calls?: Array<{
        providerRequestId: string;
        usage: import('../../shared/ai-usage').AIUsage | null;
    }>;
    state: RunState;
    durable: boolean;
    messageId: string;
    messageSaved: boolean;
    cleanupPending: boolean;
    createdAt: number;
}
export interface ToolRecord extends ToolKey {
    interactionId: string;
    executionStarted: boolean;
    receiptRef?: string;
}
const terminal = new Set<RunState>(['completed', 'failed', 'cancelled', 'interrupted']);
const nextStates: Record<RunState, RunState[]> = {
    starting: ['running', 'failed', 'cancelled', 'interrupted'],
    running: ['waiting-user', 'cancelling', 'completed', 'failed', 'cancelled', 'interrupted'],
    'waiting-user': ['running', 'cancelling', 'failed', 'cancelled', 'interrupted'],
    cancelling: ['cancelled', 'interrupted', 'failed'], completed: [], failed: [], cancelled: [], interrupted: []
};
/** Association ledger only. Business actions and their receipts stay in the original services. */
export class HarnessStore {
    private db: Database.Database;
    constructor(path: string) {
        if (path !== ':memory:')
            mkdirSync(dirname(path), { recursive: true });
        this.db = new Database(path);
        this.db.pragma('foreign_keys = ON');
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = FULL');
        const version = this.db.pragma('user_version', { simple: true }) as number;
        if (version > 1) {
            this.db.close();
            throw new Error('执行账本来自较新版本，未修改。');
        }
        this.db.transaction(() => {
            this.db.exec(`CREATE TABLE IF NOT EXISTS runs(request_id TEXT NOT NULL, attempt_id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(request_id,attempt_id));
        CREATE TABLE IF NOT EXISTS tools(request_id TEXT NOT NULL, attempt_id TEXT NOT NULL, call_id TEXT NOT NULL, value TEXT NOT NULL,
          PRIMARY KEY(request_id,attempt_id,call_id), FOREIGN KEY(request_id,attempt_id) REFERENCES runs(request_id,attempt_id));
        PRAGMA user_version=1;`);
        })();
    }
    get(key: RunKey): RunRecord | undefined {
        const row = this.db.prepare('SELECT value FROM runs WHERE request_id=? AND attempt_id=?').get(key.requestId, key.attemptId) as {
            value: string;
        } | undefined;
        return row && JSON.parse(row.value);
    }
    begin(input: HarnessInput): RunRecord {
        if (!input.characterId || !input.sessionId)
            throw new Error('DSH 执行必须属于明确的联系人会话。');
        return this.db.transaction(() => {
            const old = this.get(input);
            if (old) {
                if (old.characterId !== input.characterId || old.sessionId !== input.sessionId || old.snapshotFingerprint !== input.snapshotFingerprint || old.configVersion !== input.configVersion)
                    throw new Error('执行关联已存在，不能替换。');
                return old;
            }
            const record: RunRecord = { requestId: input.requestId, attemptId: input.attemptId, characterId: input.characterId!, sessionId: input.sessionId!, engine: 'dsh', version: '0.2.1-alpha.3', snapshotFingerprint: input.snapshotFingerprint, configVersion: input.configVersion, state: 'starting', durable: false, messageId: `harness-${randomUUID()}`, messageSaved: false, cleanupPending: false, createdAt: Date.now() };
            this.db.prepare('INSERT INTO runs VALUES(?,?,?)').run(record.requestId, record.attemptId, JSON.stringify(record));
            return record;
        }).immediate();
    }
    private update(key: RunKey, apply: (record: RunRecord) => void): void {
        this.db.transaction(() => {
            const record = this.get(key);
            if (!record)
                throw new Error('执行关联不存在。');
            apply(record);
            this.db.prepare('UPDATE runs SET value=? WHERE request_id=? AND attempt_id=?').run(JSON.stringify(record), key.requestId, key.attemptId);
        }).immediate();
    }
    transition(key: RunKey, expected: RunState, next: RunState): boolean {
        let changed = false;
        this.update(key, record => {
            if (record.state !== expected || !nextStates[expected].includes(next))
                return;
            record.state = next;
            changed = true;
        });
        return changed;
    }
    bindSession(key: RunKey, id: string): void {
        this.update(key, record => {
            if (record.dshSessionId && record.dshSessionId !== id)
                throw new Error('DSH 会话关联不可替换。');
            record.dshSessionId = id;
        });
    }
    markDurable(key: RunKey): void { this.update(key, record => { if (!record.dshSessionId)
        throw new Error('会话尚未关联。'); record.durable = true; }); }
    bindInput(key: RunKey, id: string): void { this.update(key, record => { if (record.inputMessageId && record.inputMessageId !== id)
        throw new Error('输入关联不可替换。'); record.inputMessageId = id; }); }
    bindRuntime(key: RunKey, group: string): void { this.update(key, record => { record.runtimeGroup = group; }); }
    recordUsage(key: RunKey, providerRequestId: string, usage: import('../../shared/ai-usage').AIUsage | null): void { this.update(key, record => { record.calls ??= []; if (!record.calls.some(c => c.providerRequestId === providerRequestId))
        record.calls.push({ providerRequestId, usage }); }); }
    markMessageSaved(key: RunKey): void { this.update(key, record => { record.messageSaved = true; }); }
    markCleanup(key: RunKey, pending: boolean): void { this.update(key, record => { record.cleanupPending = pending; }); }
    tools(key: RunKey): ToolRecord[] {
        return (this.db.prepare('SELECT value FROM tools WHERE request_id=? AND attempt_id=?').all(key.requestId, key.attemptId) as {
            value: string;
        }[]).map(row => JSON.parse(row.value));
    }
    linkTool(key: ToolKey, interactionId: string): void {
        this.db.transaction(() => {
            const old = this.tools(key).find(t => t.callId === key.callId);
            if (old) {
                if (old.interactionId !== interactionId)
                    throw new Error('工具关联不可替换。');
                return;
            }
            const record: ToolRecord = { requestId: key.requestId, attemptId: key.attemptId, callId: key.callId, interactionId, executionStarted: false };
            this.db.prepare('INSERT INTO tools VALUES(?,?,?,?)').run(key.requestId, key.attemptId, key.callId, JSON.stringify(record));
        }).immediate();
    }
    private updateTool(key: ToolKey, apply: (record: ToolRecord) => void): void {
        this.db.transaction(() => {
            const record = this.tools(key).find(t => t.callId === key.callId);
            if (!record)
                throw new Error('工具关联不存在。');
            apply(record);
            this.db.prepare('UPDATE tools SET value=? WHERE request_id=? AND attempt_id=? AND call_id=?').run(JSON.stringify(record), key.requestId, key.attemptId, key.callId);
        }).immediate();
    }
    markToolStarted(key: ToolKey): void { this.updateTool(key, record => { record.executionStarted = true; }); }
    recordReceipt(key: ToolKey, receiptRef: string): void {
        this.updateTool(key, record => {
            if (record.receiptRef && record.receiptRef !== receiptRef)
                throw new Error('工具回执不可替换。');
            record.receiptRef = receiptRef;
        });
    }
    all(): RunRecord[] { return (this.db.prepare('SELECT value FROM runs').all() as {
        value: string;
    }[]).map(row => JSON.parse(row.value)); }
    listUnsettled(): RunRecord[] { return this.all().filter(r => !terminal.has(r.state) || r.state === 'completed' && !r.messageSaved || r.cleanupPending); }
    close(): void { if (this.db.open)
        this.db.close(); }
}
