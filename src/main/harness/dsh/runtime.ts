import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
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
    tools: Set<Promise<unknown>>;
    round: number;
    roundPending: boolean;
    failure?: unknown;
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
                    try { input.rounds.onMetadata?.(dshMetadata(value.usage, value.finish)); }
                    finally { input.rounds.afterRound?.(); }
                } catch (error) { current.failure ??= error; throw error; }
                finally { current.roundPending = false; current.round++; }
                if (value.finish?.kind === 'error' && typeof value.finish.failure?.message === 'string') current.failure ??= new Error(value.finish.failure.message);
                return true;
            }
            if (input.signal.aborted) {
                if (method === 'stream')
                    return true;
                throw new Error('AI 请求已取消。');
            }
            if (method === 'round:before') {
                try {
                    if (!input.rounds || current.roundPending || value.round !== current.round || typeof value.serializedInput !== 'string') throw new Error('DSH 后台请求归属无效。');
                    if (current.round >= 6) throw new Error('工具调用次数超过安全上限。');
                    await input.assertContext();
                    const cap = await input.rounds.beforeRound?.(current.round, value.serializedInput) ?? input.rounds.maxOutputTokens ?? 16384;
                    if (!Number.isSafeInteger(cap) || cap < 1) throw new Error('后台输出额度无效。');
                    current.roundPending = true;
                    input.signal.throwIfAborted();
                    return { maxOutputTokens: cap };
                } catch (error) { current.failure ??= error; throw error; }
            }
            if (method === 'tool') {
                if (typeof value.callId !== 'string' || typeof value.name !== 'string' || !input.tools?.definitions.some(t => t.name === value.name))
                    throw new Error('DSH 工具不在本次授权目录内。');
                await input.assertContext();
                input.signal.throwIfAborted();
                if (!input.tools.subscribe) emit({ type: 'tool', callId: value.callId, status: 'running' });
                const work = input.tools.execute({ id: value.callId, name: value.name, arguments: JSON.stringify(value.args) });
                current.tools.add(work);
                let result: string;
                try { result=await work; } finally { current.tools.delete(work); }
                if (!input.tools.subscribe) emit({ type: 'tool', callId: value.callId, status: 'completed' });
                return result;
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
        const active: Active = {input,emit,stream,tools:new Set(),round:0,roundPending:false};
        this.active.set(input.attemptId, active);
        let cancelling: Promise<void> | undefined;
        const abort = () => { cancelling = this.cancel(input).catch(() => { }); };
        input.signal.addEventListener('abort', abort, { once: true });
        try {
            input.signal.throwIfAborted();
            await input.assertContext();
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
            input.signal.removeEventListener('abort', abort);
            await cancelling;
            if (input.signal.aborted) await Promise.allSettled([...active.tools]);
            try { if (active.roundPending) input.rounds?.afterRound?.(); }
            finally { this.active.delete(input.attemptId); }
        }
    }
    async inspect(sessionId: string, inputMessageId: string): Promise<string | undefined> { return await this.plugin!.request('inspect', { sessionId, inputMessageId }, { timeoutMs: 30000 }) ?? undefined; }
    async cancel(key: RunKey): Promise<void> { if (this.plugin && !this.closed)
        await this.plugin.request('cancel', { ...key, sessionId: key.attemptId }, { timeoutMs: 15000 }); }
    async flush(key: RunKey): Promise<boolean> { return Boolean(await this.plugin?.request('flush', { ...key, sessionId: key.attemptId }, { timeoutMs: 15000 })); }
    async release(key: RunKey): Promise<void> { if (this.plugin && !this.closed)
        await this.plugin.request('dispose', { ...key, sessionId: key.attemptId }, { timeoutMs: 15000 }); }
    close(): Promise<void> {
        return this.closePromise ??= (async () => {
            this.closed = true;
            try {
                await this.helper?.request('close', {}, { timeoutMs: 15000 });
            }
            catch { /* SDK/process failure; reap below. */ }
            await this.transport.close();
            const child = this.child;
            if (child && child.exitCode === null && child.signalCode === null)
                await new Promise<void>(resolve => {
                    const timer = setTimeout(() => {
                        if (process.platform === 'win32' && child.pid)
                            execFile(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, () => resolve());
                        else {
                            child.kill('SIGKILL');
                            resolve();
                        }
                    }, 3000);
                    child.once('exit', () => { clearTimeout(timer); resolve(); });
                    if (!child.pid) {
                        clearTimeout(timer);
                        resolve();
                    }
                });
        })();
    }
}
export { resolveDshRuntimePaths } from '../runtime-paths';
export class DshRuntimePool {
    private groups = new Map<string, Promise<DshRuntime>>();
    private closed = false;
    constructor(private options: DshRuntimeOptions) { }
    async acquire(input: HarnessInput): Promise<DshRuntimeLease> {
        if (this.closed) throw new Error('DSH 运行池已关闭。');
        input.signal.throwIfAborted();
        mapProvider(input.config, {tools:Boolean(input.tools?.definitions.length),images:input.messages.some(m=>Boolean(m.imageUrl))});
        const group = dshRuntimeGroup(input);
        let pending = this.groups.get(group);
        if (!pending) {
            const runtime = new DshRuntime({ ...this.options, home: join(this.options.home, group) });
            pending = runtime.start(input).then(() => runtime).catch(error => { this.groups.delete(group); throw error; });
            this.groups.set(group, pending);
        }
        let abort: (() => void) | undefined;
        const interrupted = new Promise<never>((_resolve, reject) => {
            abort = () => reject(input.signal.reason);
            input.signal.addEventListener('abort', abort, { once: true });
            if (input.signal.aborted) abort();
        });
        const runtime = await Promise.race([pending, interrupted]).finally(() => input.signal.removeEventListener('abort', abort!));
        input.signal.throwIfAborted();
        if (this.closed) throw new Error('DSH 运行池已关闭。');
        if (runtime.isClosed) {
            await runtime.close();
            if (this.groups.get(group) === pending) this.groups.delete(group);
            return this.acquire(input);
        }
        const assertOwner = (key: RunKey) => { if (key.requestId !== input.requestId || key.attemptId !== input.attemptId)
            throw new Error('DSH 请求归属无效。'); };
        return { run: async (value, emit) => { assertOwner(value); if (value !== input)
                throw new Error('DSH 上下文归属不可替换。'); return runtime.run(value, emit); }, cancel: async (key) => { assertOwner(key); await runtime.cancel(key); }, flush: async (key) => { assertOwner(key); return runtime.flush(key); }, release: () => runtime.release(input) };
    }
    async close(): Promise<void> { this.closed = true; const groups = [...this.groups.values()]; this.groups.clear(); await Promise.all(groups.map(async (pending) => { try {
        await (await pending).close();
    }
    catch { } })); }
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
