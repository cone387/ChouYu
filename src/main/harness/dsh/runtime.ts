import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { MAX_TOOL_ROUNDS } from '../limits';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DshTransport } from './transport';
import { DshStreamReducer } from './stream';
import { dshMetadata } from './metadata';
import { DEFAULT_APP_CONFIG } from '../../../shared/config';
import type { RpcPeer } from '../../../../runtime/dsh/wire.mjs';
import { mapProvider } from '../../../../runtime/dsh/provider.mjs';
import type { HarnessInput, HarnessResult, HarnessSink, RunKey, BackgroundHarnessInput } from '../contracts';
export interface DshRunInput extends HarnessInput { rounds?: BackgroundHarnessInput['options'] }
export interface DshRuntimeLease {
    run(input: HarnessInput, emit: HarnessSink): Promise<HarnessResult>;
    cancel(key: RunKey): Promise<void>;
    flush(key: RunKey): Promise<boolean>;
    release(): void | Promise<void>;
}
import type { DshRuntimeOptions } from '../contracts';
export type { DshRuntimeOptions } from '../contracts';
type Active = {
    input: DshRunInput;
    emit: HarnessSink;
    stream: DshStreamReducer;
    hostWork: Set<Promise<unknown>>;
    finishing: boolean;
    round: number;
    roundPending: boolean;
    settlement?: Promise<void>;
    failure?: unknown;
    executionFinished: Promise<void>;
};
class DshRuntime {
    private transport: DshTransport;
    private child?: ChildProcess;
    private helper?: RpcPeer;
    private plugin?: RpcPeer;
    private active = new Map<string, Active>();
    private closed = false;
    private closePromise?: Promise<void>;
    get isClosed(): boolean {
        if (this.closed || this.helper?.closed || this.plugin?.closed || this.child && (this.child.exitCode !== null || this.child.signalCode !== null)) return true;
        // The OS exit can precede Node's queued child 'exit' notification.
        try { if (this.child?.pid) process.kill(this.child.pid, 0); } catch { return true; }
        return false;
    }
    constructor(private options: DshRuntimeOptions) {
        this.transport = new DshTransport(async (role, method, value) => {
            if (role !== 'plugin' || !value || typeof value.sessionId !== 'string')
                throw new Error('DSH 事件归属无效。');
            const current = this.active.get(value.sessionId);
            if (!current || current.input.requestId !== value.requestId || current.input.attemptId !== value.attemptId)
                throw new Error('DSH 请求已经结束或归属无效。');
            const { input, emit } = current;
            if (method === 'round:after') {
                if (!input.rounds || !current.roundPending || value.round !== current.round) throw new Error('DSH 后台结算归属无效。');
                try {
                    current.settlement = (async () => {
                        try { input.rounds!.onMetadata?.(dshMetadata(value.usage, value.finish)); }
                        finally { await input.rounds!.afterRound?.(); }
                    })();
                    await current.settlement;
                } catch (error) { current.failure ??= error; throw error; }
                finally { current.roundPending = false; current.settlement = undefined; current.round++; }
                if (value.finish?.kind === 'error' && typeof value.finish.failure?.message === 'string') current.failure ??= new Error(value.finish.failure.message);
                return true;
            }
            if (input.signal.aborted || this.closed || current.finishing) {
                if (method === 'stream')
                    return true;
                throw new Error('AI 请求已取消。');
            }
            if (method === 'round:before') {
                return this.trackHostWork(current, async () => { try {
                    if (!input.rounds || current.roundPending || value.round !== current.round || typeof value.serializedInput !== 'string') throw new Error('DSH 后台请求归属无效。');
                    if (current.round >= MAX_TOOL_ROUNDS) throw new Error('工具调用次数超过安全上限。');
                    await input.assertContext();
                    this.assertExecuting(current);
                    const cap = await input.rounds.beforeRound?.(current.round, value.serializedInput) ?? input.rounds.maxOutputTokens ?? 16384;
                    if (!Number.isSafeInteger(cap) || cap < 1) throw new Error('后台输出额度无效。');
                    current.roundPending = true;
                    this.assertExecuting(current);
                    return { maxOutputTokens: cap };
                } catch (error) { current.failure ??= error; throw error; } });
            }
            if (method === 'tool') {
                return this.trackHostWork(current, async () => {
                if (typeof value.callId !== 'string' || typeof value.name !== 'string' || !input.tools?.definitions.some(t => t.name === value.name))
                    throw new Error('DSH 工具不在本次授权目录内。');
                await input.assertContext();
                this.assertExecuting(current);
                if (!input.tools.subscribe) emit({ type: 'tool', callId: value.callId, status: 'running' });
                const result = await input.tools.execute({ id: value.callId, name: value.name, arguments: JSON.stringify(value.args) });
                this.assertExecuting(current);
                if (!input.tools.subscribe) emit({ type: 'tool', callId: value.callId, status: 'completed' });
                return result;
                });
            }
            if (method === 'stream') {
                try {
                for (const update of current.stream.accept(value.frame)) {
                    if (update.type === 'usage' && !input.rounds)
                        input.onMetadata?.(update.metadata);
                    emit(update);
                }
                return true;
                } catch (error) { current.failure ??= error; throw error; }
            }
            throw new Error('DSH 事件类型无效。');
        }, () => { if (!this.closed)
            void this.close(); });
    }
    private assertExecuting(current: Active) {
        current.input.signal.throwIfAborted();
        if (this.closed || current.finishing) throw current.failure ?? new Error('DSH 请求已经结束。');
    }
    private trackHostWork<T>(current: Active, operation: () => Promise<T>): Promise<T> {
        const work = operation();
        current.hostWork.add(work);
        return work.finally(() => current.hostWork.delete(work));
    }
    async start(input: Pick<HarnessInput, 'config' | 'messages' | 'tools'>): Promise<void> {
        mapProvider(input.config, { tools: Boolean(input.tools?.definitions.length), images: input.messages.some(m => Boolean(m.imageUrl)) });
        mkdirSync(this.options.home, { recursive: true });
        const port = await this.transport.listen();
        const env: NodeJS.ProcessEnv = {};
        for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'Path', 'PATHEXT', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'])
            if (process.env[key])
                env[key] = process.env[key];
        Object.assign(env, { CHOUYU_DSH_PORT: String(port), CHOUYU_DSH_TOKEN: this.transport.token, CHOUYU_DSH_HOME: this.options.home,
            CHOUYU_DSH_CONFIG: JSON.stringify({ provider: input.config.provider, baseUrl: input.config.baseUrl, model: input.config.model }), CHOUYU_DSH_API_KEY: input.config.apiKey });
        this.child = spawn(this.options.node, [this.options.helper, '--serve'], { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
        // Consume stderr without retaining secrets or unbounded child output.
        this.child.stderr?.resume();
        this.child.once('error', () => { void this.close(); });
        this.child.once('exit', () => { if (!this.closed)
            void this.close(); });
        try {
            this.helper = await this.transport.wait('helper', this.options.startupTimeoutMs);
            await this.helper.request('ready', {}, { timeoutMs: 35000 });
            this.plugin = await this.transport.wait('plugin');
        }
        catch (error) {
            await this.close();
            throw error;
        }
    }
    async run(input: DshRunInput, emit: HarnessSink): Promise<HarnessResult> {
        if (this.closed || !this.helper || !this.plugin)
            throw new Error('DSH 运行时不可用。');
        if (this.active.has(input.attemptId))
            throw new Error('DSH 尝试已经在执行。');
        const last = input.messages.at(-1);
        if (!last || last.role !== 'user')
            throw new Error('DSH 当前输入必须是最后一条用户消息，尚未执行。');
        const stream = new DshStreamReducer();
        let finishExecution!: () => void;
        const executionFinished = new Promise<void>(resolve => { finishExecution = resolve; });
        const active: Active = {input,emit,stream,hostWork:new Set(),finishing:false,round:0,roundPending:false,executionFinished};
        this.active.set(input.attemptId, active);
        let cancelling: Promise<void> | undefined;
        const abort = () => { cancelling = this.cancel(input).catch(() => { }); };
        input.signal.addEventListener('abort', abort, { once: true });
        try {
            input.signal.throwIfAborted();
            await input.assertContext();
            this.assertExecuting(active);
            const prepared = await this.plugin.request('prepare', { requestId: input.requestId, attemptId: input.attemptId, sessionId: input.attemptId, prompt: last.content, history: input.messages.slice(0, -1), systemPrompt: input.systemPrompt, tools: input.tools?.definitions ?? [], model: input.config.model, rounds: Boolean(input.rounds), maxOutputTokens: input.rounds?.maxOutputTokens ?? 16384 }, { timeoutMs: 30000 });
            emit({ type: 'prepared', inputMessageId: prepared.inputMessageId });
            input.signal.throwIfAborted();
            const result = await this.plugin.request('run', { requestId: input.requestId, attemptId: input.attemptId, sessionId: input.attemptId, prompt: last.content }) as HarnessResult & {
                committedSeq?: number;
            };
            if (active.failure) throw active.failure;
            if (result.state === 'completed' && !stream.verify(result.committedSeq!))
                throw new Error('DSH 正式回复与流记录不一致。');
            if (result.state === 'completed' && !await this.flush(input))
                throw new Error('DSH 回复尚未确认落盘。');
            return result;
        }
        catch (error) { throw active.failure ?? error; }
        finally {
            active.finishing = true;
            finishExecution();
            input.signal.removeEventListener('abort', abort);
            await cancelling;
            // A broken shared runtime fails every peer, but none releases capacity before it is reaped.
            await this.closePromise;
            // Admission can still be reserving budget after its remote caller dies. Drain it before settlement.
            await Promise.allSettled([...active.hostWork]);
            try { if (active.settlement) await active.settlement; else if (active.roundPending) await input.rounds?.afterRound?.(); }
            finally { this.active.delete(input.attemptId); }
        }
    }
    async inspect(sessionId: string, inputMessageId: string): Promise<string | undefined> { return await this.plugin!.request('inspect', { sessionId, inputMessageId }, { timeoutMs: 30000 }) ?? undefined; }
    async cancel(key: RunKey): Promise<void> {
        if (!this.plugin || this.closed) { await this.closePromise; return; }
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                (async () => {
                    await this.plugin!.request('cancel', { ...key, sessionId: key.attemptId }, { timeoutMs: this.options.cancelTimeoutMs ?? 15000 });
                    await this.active.get(key.attemptId)?.executionFinished;
                })(),
                new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('DSH 取消未完成，正在结束失联运行时。')), this.options.cancelTimeoutMs ?? 15000); })
            ]);
        } catch (error) { await this.close(true); throw error; }
        finally { clearTimeout(timer); }
    }
    async flush(key: RunKey): Promise<boolean> { return Boolean(await this.plugin?.request('flush', { ...key, sessionId: key.attemptId }, { timeoutMs: 15000 })); }
    async release(key: RunKey): Promise<void> { if (this.plugin && !this.closed)
        await this.plugin.request('dispose', { ...key, sessionId: key.attemptId }, { timeoutMs: 15000 }); }
    close(force = false): Promise<void> {
        return this.closePromise ??= (async () => {
            this.closed = true;
            const failure = new Error('DSH 运行时已关闭，本次请求未完成；未自动重放。');
            for (const current of this.active.values()) {
                current.failure ??= failure;
                current.input.cancelTools?.(failure);
            }
            try {
                if (!force) await this.helper?.request('close', {}, { timeoutMs: 15000 });
            }
            catch { /* SDK/process failure; reap below. */ }
            if (!force) await this.transport.close();
            const child = this.child;
            if (child && child.exitCode === null && child.signalCode === null)
                await new Promise<void>(resolve => {
                    let terminating = false, warned = false;
                    let timer: ReturnType<typeof setTimeout>;
                    const exited = () => child.exitCode !== null || child.signalCode !== null;
                    const retry = () => {
                        if (!warned) { console.warn('[DSH] 运行时终止尚未成功，保留执行名额并重试清理。'); warned = true; }
                        timer = setTimeout(terminate, 1000);
                    };
                    const terminate = () => {
                        terminating = true;
                        if (process.platform === 'win32' && child.pid) {
                            execFile(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, error => {
                                // Wait for both the process exit and the tree-kill command, not merely its launch.
                                terminating = false;
                                if (exited()) { resolve(); return; }
                                if (error) retry();
                            });
                        } else {
                            try { child.kill('SIGKILL'); } catch { retry(); }
                            finally { terminating = false; if (exited()) resolve(); }
                        }
                    };
                    timer = setTimeout(terminate, force ? 0 : 3000);
                    child.once('exit', () => { clearTimeout(timer); if (!terminating) resolve(); });
                    if (!child.pid) {
                        clearTimeout(timer);
                        resolve();
                    }
                });
            await this.transport.close();
        })();
    }
}
export { resolveDshRuntimePaths } from '../runtime-paths';
type RuntimeGroup = {
    runtime: DshRuntime;
    ready: Promise<DshRuntime>;
    leases: number;
    idleAt: number;
    timer?: ReturnType<typeof setTimeout>;
    closing?: Promise<void>;
};
export class DshRuntimePool {
    private groups = new Map<string, RuntimeGroup>();
    private closed = false;
    private closing?: Promise<void>;
    private admission = Promise.resolve();
    constructor(private options: DshRuntimeOptions) {
        for (const value of [options.maxRuntimeGroups ?? 8, options.idleTimeoutMs ?? 300000, options.cancelTimeoutMs ?? 15000])
            if (!Number.isSafeInteger(value) || value < 1) throw new Error('DSH 运行时容量和时限必须为正整数。');
    }
    private retire(group: string, entry: RuntimeGroup): Promise<void> {
        if (entry.closing) return entry.closing;
        clearTimeout(entry.timer);
        entry.closing = entry.ready.catch(() => entry.runtime).then(runtime => runtime.close()).then(() => {
            if (this.groups.get(group) === entry) this.groups.delete(group);
        }).catch(error => { entry.closing = undefined; throw error; });
        return entry.closing;
    }
    private released(group: string, entry: RuntimeGroup) {
        entry.leases--;
        if (entry.leases || this.closed) return;
        entry.idleAt = Date.now();
        entry.timer = setTimeout(() => {
            if (!entry.leases) void this.retire(group, entry).catch(() => { /* Keep failed cleanup owned for close/retry. */ });
        }, this.options.idleTimeoutMs ?? 300000);
        entry.timer.unref();
    }
    private reserve(group: string, input: HarnessInput): Promise<RuntimeGroup> {
        // Serialize admission/eviction only; independent runtime startup and execution remain parallel.
        const result = this.admission.then(async () => {
            if (this.closed) throw new Error('DSH 运行池已关闭。');
            input.signal.throwIfAborted();
            let entry = this.groups.get(group);
            if (entry?.closing || entry?.runtime.isClosed) {
                await this.retire(group, entry);
                entry = undefined;
            }
            if (!entry) {
                if (this.groups.size >= (this.options.maxRuntimeGroups ?? 8)) {
                    const idle = [...this.groups].filter(([, value]) => !value.leases).sort((a, b) => a[1].idleAt - b[1].idleAt)[0];
                    if (!idle) throw new Error('DSH 运行时容量已达上限，请等待其他请求结束后重试。');
                    await this.retire(...idle);
                }
                if (this.closed) throw new Error('DSH 运行池已关闭。');
                input.signal.throwIfAborted();
                const runtime = new DshRuntime({ ...this.options, home: join(this.options.home, group) });
                entry = { runtime, ready: runtime.start(input).then(() => runtime), leases: 0, idleAt: 0 };
                void entry.ready.catch(() => {});
                this.groups.set(group, entry);
            }
            clearTimeout(entry.timer);
            entry.leases++;
            return entry;
        });
        this.admission = result.then(() => {}, () => {});
        return result;
    }
    async acquire(input: HarnessInput): Promise<DshRuntimeLease> {
        if (this.closed) throw new Error('DSH 运行池已关闭。');
        input.signal.throwIfAborted();
        mapProvider(input.config, {tools:Boolean(input.tools?.definitions.length),images:input.messages.some(m=>Boolean(m.imageUrl))});
        const group = dshRuntimeGroup(input);
        const entry = await this.reserve(group, input);
        let abort: (() => void) | undefined;
        const interrupted = new Promise<never>((_resolve, reject) => {
            abort = () => reject(input.signal.reason);
            input.signal.addEventListener('abort', abort, { once: true });
            if (input.signal.aborted) abort();
        });
        let runtime: DshRuntime;
        try {
            runtime = await Promise.race([entry.ready, interrupted]);
            input.signal.throwIfAborted();
            if (this.closed) throw new Error('DSH 运行池已关闭。');
            if (runtime.isClosed) throw new Error('DSH 运行时已退出，请重新发起请求。');
        } catch (error) { this.released(group, entry); throw error; }
        finally { input.signal.removeEventListener('abort', abort!); }
        let released: Promise<void> | undefined;
        let running: Promise<HarnessResult> | undefined;
        const assertOwner = (key: RunKey) => { if (released) throw new Error('DSH 执行租约已释放。'); if (key.requestId !== input.requestId || key.attemptId !== input.attemptId)
            throw new Error('DSH 请求归属无效。'); };
        return { run: async (value, emit) => { assertOwner(value); if (value !== input)
                throw new Error('DSH 上下文归属不可替换。');
                if (running) throw new Error('DSH 尝试不能重放。');
                running = runtime.run(value, emit); return running;
            }, cancel: async (key) => { assertOwner(key); await runtime.cancel(key); }, flush: async (key) => { assertOwner(key); return runtime.flush(key); },
            release: () => released ??= (async () => {
                try {
                    // A caller releasing early cannot make running work eligible for eviction.
                    if (running) { await running.catch(() => {}); await runtime.release(input); }
                } catch (error) { await runtime.close(true); throw error; }
                finally { this.released(group, entry); }
            })()
        };
    }
    close(): Promise<void> {
        this.closed = true;
        return this.closing ??= this.admission.then(async () => {
            await Promise.all([...this.groups].map(([group, entry]) => this.retire(group, entry)));
        }).catch(error => { this.closing = undefined; throw error; });
    }
}
export function dshRuntimeGroup(input: HarnessInput): string { return createHash('sha256').update(JSON.stringify([input.config.provider, input.config.baseUrl, input.config.model, input.configVersion])).digest('hex'); }
export async function inspectDshRun(options: DshRuntimeOptions, run: {
    runtimeGroup?: string;
    dshSessionId?: string;
    inputMessageId?: string;
}): Promise<string | undefined> {
    if (!run.runtimeGroup || !run.dshSessionId || !run.inputMessageId)
        return undefined;
    if (!/^[a-f0-9]{64}$/.test(run.runtimeGroup))
        throw new Error('DSH 运行环境归属无效。');
    const runtime = new DshRuntime({ ...options, home: join(options.home, run.runtimeGroup) });
    try {
        await runtime.start({ config: { ...DEFAULT_APP_CONFIG, provider: 'openai', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'recovery-no-dispatch', model: 'recovery' }, messages: [] });
        return await runtime.inspect(run.dshSessionId, run.inputMessageId);
    }
    finally {
        await runtime.close();
    }
}
