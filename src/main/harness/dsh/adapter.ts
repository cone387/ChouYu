import type { HarnessAdapter, HarnessInput, HarnessResult, HarnessSink } from '../contracts';
import type { HarnessStore } from '../store';
import type { DshRuntimePool, DshRuntimeLease } from './runtime';
import { dshRuntimeGroup } from './runtime';
export class DshAdapter implements HarnessAdapter {
    private leases = new Map<string, DshRuntimeLease>();
    async beforePersistentOffer(key: import('../contracts').ToolKey): Promise<void> {
        const run = this.store.get(key), lease = this.leases.get(JSON.stringify([key.requestId, key.attemptId]));
        if (!run || !lease || !await lease.flush(key))
            throw new Error('执行日志尚未保存，未创建确认事项。');
        this.store.markDurable(key);
    }
    constructor(private pool: Pick<DshRuntimePool, 'acquire'>, private store: HarnessStore, private cancelActions?: (key: HarnessInput) => Promise<void>, private cleanup?: (run: import('../store').RunRecord) => Promise<void>) { }
    async invalidate(input: HarnessInput): Promise<void> {
        const run=this.store.get(input); if (!run) return;
        this.store.suppressDelivery(input);
        if (!this.leases.has(JSON.stringify([input.requestId,input.attemptId]))) {
            try { await this.cleanup?.(this.store.get(input)!); } catch { /* cleanupPending remains durable and visible */ }
        }
    }
    async run(input: HarnessInput, emit: HarnessSink): Promise<HarnessResult> {
        if (this.store.get(input))
            return { state: 'interrupted', error: '此执行已有记录，未自动重放。请重新发送消息。' };
        this.store.begin(input);
        this.store.bindRuntime(input, dshRuntimeGroup(input));
        let lease: DshRuntimeLease | undefined;
        let outcome: HarnessResult;
        try {
            input.signal.throwIfAborted();
            await input.assertContext();
            lease = await this.pool.acquire(input);
            this.leases.set(JSON.stringify([input.requestId, input.attemptId]), lease);
            this.store.bindSession(input, input.attemptId);
            this.store.transition(input, 'starting', 'running');
            const result = await lease.run(input, event => {
                if (event.type === 'prepared')
                    this.store.bindInput(input, event.inputMessageId);
                if (event.type === 'usage')
                    this.store.recordUsage(input, event.providerRequestId, event.metadata.usage ?? null);
                emit(event);
            });
            if (result.state === 'completed') {
                if (!await lease.flush(input))
                    throw new Error('执行日志尚未确认保存。');
                this.store.markDurable(input);
            }
            input.signal.throwIfAborted();
            await input.assertContext();
            input.signal.throwIfAborted();
            const record = this.store.get(input)!;
            if (!this.store.transition(input, record.state, result.state))
                throw new Error('执行状态已变化，不能发布回复。');
            outcome = result.state === 'completed' ? { ...result, source: { requestId: input.requestId, attemptId: input.attemptId, engine: 'dsh', version: record.version, messageId: record.messageId } } : result;
        }
        catch (error) {
            const state = input.signal.aborted ? 'cancelled' : 'failed';
            const record = this.store.get(input)!;
            this.store.transition(input, record.state, state);
            this.store.suppressDelivery(input);
            outcome = { state, error: error instanceof Error ? error.message : 'DSH 执行失败。' };
        }
        finally {
            this.leases.delete(JSON.stringify([input.requestId, input.attemptId]));
        }
        const cleanupErrors: string[] = [];
        const attemptCleanup = async (action: () => void | Promise<void>) => {
            try { await action(); }
            catch (error) { cleanupErrors.push(error instanceof Error ? error.message : 'DSH 清理失败。'); }
        };
        if (input.signal.aborted) await attemptCleanup(() => this.cancelActions?.(input));
        await attemptCleanup(() => lease?.release());
        if (cleanupErrors.length || input.signal.aborted) this.store.suppressDelivery(input);
        const run = this.store.get(input)!;
        if (run.state !== 'completed' || run.deliverySuppressed) {
            this.store.markCleanup(input, true);
            await attemptCleanup(() => this.cleanup?.(this.store.get(input)!));
        }
        if (cleanupErrors.length) {
            const error = `${outcome.state !== 'completed' ? `${outcome.error} ` : ''}清理未完成：${cleanupErrors.join('；')}`;
            return { state: input.signal.aborted ? 'cancelled' : outcome.state === 'completed' ? 'failed' : outcome.state, error };
        }
        return outcome;
    }
}
