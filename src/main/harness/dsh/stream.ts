import type { HarnessUpdate } from '../contracts';
import type { AIUsage } from '../../../shared/ai-usage';
import { dshMetadata } from './metadata';
export interface DshCallUsage {
    providerRequestId: string;
    usage: AIUsage | null;
}
export class DshStreamReducer {
    private revision = 0;
    private attempt = '';
    private index = 0;
    private ended = false;
    private committed?: number;
    private records: DshCallUsage[] = [];
    private usage: AIUsage | null = null;
    private finish?: unknown;
    accept(raw: unknown): HarnessUpdate[] {
        const f = raw as any;
        if (!f || typeof f.attemptId !== 'string' || !Number.isSafeInteger(f.revision))
            throw new Error('DSH 流格式无效。');
        if (f.revision <= this.revision)
            return [];
        if (f.revision !== this.revision + 1)
            throw new Error('DSH 流版本缺口。');
        this.revision = f.revision;
        if (f.type === 'start') {
            this.revision = f.revision;
            this.attempt = f.attemptId;
            this.index = 0;
            this.ended = false;
            this.committed = undefined;
            this.usage = null;
            this.finish = undefined;
            this.records.push({ providerRequestId: f.attemptId, usage: null });
            return [{ type: 'text', text: '', operation: 'replace' }];
        }
        if (f.attemptId !== this.attempt || !Number.isSafeInteger(f.index))
            throw new Error('DSH 流归属无效。');
        if (f.index < this.index || this.ended && f.index === this.index)
            return [];
        if (f.index !== this.index)
            throw new Error('DSH 流片段缺口。');
        if (f.type === 'chunk') {
            this.index++;
            if (f.chunk?.type === 'usage') {
                this.usage = dshMetadata(f.chunk.usage ?? f.chunk).usage ?? null;
            }
            if (f.chunk?.type === 'finish') this.finish = f.chunk.reason;
            return f.chunk?.type === 'text-delta' && typeof f.chunk.text === 'string' ? [{ type: 'text', text: f.chunk.text, operation: 'append' }] : [];
        }
        if (f.type !== 'end')
            throw new Error('DSH 流事件无效。');
        this.ended = true;
        if (f.outcome?.kind === 'committed' && f.outcome.eventType === 'assistant/message')
            this.committed = f.outcome.seq;
        this.records.at(-1)!.usage = this.usage;
        return [{ type: 'usage', providerRequestId: this.attempt, metadata: { ...dshMetadata(undefined, this.finish), usage: this.usage ?? undefined } }];
    }
    verify(seq: number): boolean { return this.ended && this.committed === seq; }
    calls(): DshCallUsage[] { return structuredClone(this.records); }
}
