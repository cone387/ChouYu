import type { HarnessStore, RunRecord } from './store';
export interface RecoveryServices {
    readCommitted(run: RunRecord): Promise<string | undefined>;
    hasMessage(run: RunRecord): Promise<boolean>;
    save(run: RunRecord, text: string): Promise<void>;
    purge(run: RunRecord): Promise<void>;
}
export async function recoverHarnessRuns(store: HarnessStore, services: RecoveryServices): Promise<void> {
    const cleanup = async (run: RunRecord) => {
        store.markCleanup(run, true);
        try { await services.purge(run); store.markCleanup(run, false); }
        catch { /* The durable pending marker keeps failed cleanup retryable. */ }
    };
    for (const run of store.listUnsettled()) {
        if (run.cleanupPending || run.deliverySuppressed || ['cancelled', 'failed', 'interrupted'].includes(run.state)) {
            await cleanup(run);
            continue;
        }
        if (await services.hasMessage(run)) {
            store.markMessageSaved(run);
            await cleanup(run);
            continue;
        }
        const text = await services.readCommitted(run);
        if (text !== undefined) {
            if (run.state === 'starting')
                store.transition(run, 'starting', 'running');
            const current = store.get(run)!;
            if (current.state !== 'completed')
                store.transition(run, current.state, 'completed');
            await services.save(store.get(run)!, text);
            store.markMessageSaved(run);
            await cleanup(run);
        }
        else {
            if (run.state !== 'completed') store.transition(run, run.state, 'interrupted');
            else store.suppressDelivery(run);
            await cleanup(run);
        }
    }
}
export async function purgeHarnessRuns(store: HarnessStore, scope: {
    characterId: string;
    sessionId?: string;
    sourceIds?: string[];
}, services: {
    cancel(run: RunRecord): Promise<void>;
    purge(run: RunRecord): Promise<void>;
}): Promise<{
    ok: boolean;
    pendingRunIds: string[];
}> {
    const pendingRunIds: string[] = [];
    for (const run of store.all().filter(r => r.characterId === scope.characterId && (!scope.sessionId || r.sessionId === scope.sessionId))) {
        store.suppressDelivery(run);
        store.markCleanup(run, true);
        try {
            await services.cancel(run);
            await services.purge(run);
            store.markCleanup(run, false);
            store.markMessageSaved(run);
            const current = store.get(run)!;
            store.transition(run, current.state, 'interrupted');
        }
        catch {
            pendingRunIds.push(run.attemptId);
        }
    }
    return { ok: !pendingRunIds.length, pendingRunIds };
}
