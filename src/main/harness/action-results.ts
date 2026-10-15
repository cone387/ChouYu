import type { ContactActionInteraction } from '../../shared/contact-actions';
import type { RunKey, ToolKey } from './contracts';
import type { HarnessStore } from './store';
export interface ActionReceiptAccess {
    read(owner: string, id: string): Promise<ContactActionInteraction>;
    subscribe(listener: (owner: string) => void): () => void;
    cancel(owner: string, id: string, version: string): Promise<unknown>;
}
/** Observe original durable state only. This class has no business execution capability. */
export class ActionResults {
    constructor(private store: HarnessStore, private access: ActionReceiptAccess) { }
    async waitForActionReceipt(key: ToolKey, interactionId: string, signal: AbortSignal): Promise<string> {
        const run = this.store.get(key);
        if (!run)
            throw new Error('执行关联不存在。');
        this.store.linkTool(key, interactionId);
        this.store.transition(key, 'running', 'waiting-user');
        try {
            return await new Promise<string>((resolve, reject) => {
                let finished = false, reading = false, dirty = false;
                let unsubscribe = () => { };
                const finish = (error: unknown, value?: string) => { if (finished)
                    return; finished = true; unsubscribe(); signal.removeEventListener('abort', abort); error ? reject(error) : resolve(value!); };
                const abort = () => finish(signal.reason ?? new Error('AI 请求已取消。'));
                const read = async () => {
                    if (finished)
                        return;
                    if (reading) {
                        dirty = true;
                        return;
                    }
                    reading = true;
                    try {
                        do {
                            dirty = false;
                            const card = await this.access.read(run.characterId, interactionId);
                            if (finished)
                                return;
                            if (card.kind !== 'action' || card.id !== interactionId || card.characterId !== run.characterId || card.request.sessionId !== run.sessionId)
                                throw new Error('确认事项归属已变化。');
                            if (card.status === 'executing')
                                this.store.markToolStarted(key);
                            if (['resolved', 'obsolete', 'failed'].includes(card.status)) {
                                this.store.recordReceipt(key, interactionId);
                                finish(undefined, card.outcome?.content ?? card.result ?? '此事项已结束，未取得成功回执。');
                            }
                        } while (dirty && !finished);
                    }
                    catch (error) {
                        finish(error);
                    }
                    finally {
                        reading = false;
                    }
                };
                unsubscribe = this.access.subscribe(owner => { if (owner === run.characterId)
                    void read(); });
                signal.addEventListener('abort', abort, { once: true });
                if (signal.aborted)
                    abort();
                else
                    void read();
            });
        }
        finally {
            this.store.transition(key, 'waiting-user', 'running');
            // An offer may finish after the adapter's first cancellation scan.
            if (signal.aborted) await this.cancelPendingActions(key);
        }
    }
    async cancelPendingActions(key: RunKey): Promise<void> {
        const run = this.store.get(key);
        if (!run)
            return;
        for (const tool of this.store.tools(key)) {
            const card = await this.access.read(run.characterId, tool.interactionId);
            if (card.characterId !== run.characterId || card.request.sessionId !== run.sessionId)
                throw new Error('确认事项归属已变化。');
            if (card.status === 'pending' || card.status === 'failed' && card.retryable !== false)
                await this.access.cancel(run.characterId, card.id, card.version);
        }
    }
}
