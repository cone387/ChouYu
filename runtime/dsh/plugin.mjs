import { connect } from 'node:net';
import { createUserMessage, createAssistantMessage, createSystemMessage } from '@deepseek-ai/dsh-llm';
import { RpcPeer } from './wire.mjs';
import { installBudget } from './budget.mjs';
export const name = 'chouyu-harness';
export const inject = ['agents', 'sessions', 'sessionPersistence', 'tools', 'systemPrompt'];
export async function apply(ctx) {
    const handles = new Map();
    const socket = connect(Number(process.env.CHOUYU_DSH_PORT), '127.0.0.1');
    const peer = new RpcPeer(socket, async (method, value) => {
        if (method === 'inspect') {
            if (!value || typeof value.inputMessageId !== 'string' || typeof value.sessionId !== 'string')
                return null;
            if (!await ctx.sessionPersistence.stat(value.sessionId))
                return null;
            const log = await ctx.sessionPersistence.open(value.sessionId, 'read');
            try {
                const { events } = await log.read();
                const input = events.find(e => e.type === 'user/message' && e.data.id === value.inputMessageId);
                const turn = events.findLast(e => e.type === 'turn/end');
                const reply = events.findLast(e => e.type === 'assistant/message' && !e.data.interrupted);
                if (!input || !reply || reply.seq <= input.seq || turn?.data.reason?.kind !== 'completed' || turn.seq <= reply.seq)
                    return null;
                return reply.data.message.content.filter(b => b.type === 'text').map(b => b.text).join('');
            }
            finally {
                await log.close();
            }
        }
        if (method === 'prepare') {
            if (!value || typeof value.sessionId !== 'string' || handles.has(value.sessionId) || !Array.isArray(value.history) || !Array.isArray(value.tools) || typeof value.systemPrompt !== 'string')
                throw new Error('DSH 上下文无效或已存在。');
            const seed = [];
            const append = (type, data, surface = false) => seed.push({ type, data, seq: seed.length, time: Date.now(), ...(surface ? { surfaceOp: 'append' } : {}) });
            append('turn/start', { turn: 1 });
            append('step/start', { turn: 1, step: 1 });
            append('system/message', { turn: 1, step: 1, message: createSystemMessage(value.systemPrompt) }, true);
            for (const item of value.history) {
                if (!item || typeof item.content !== 'string' || item.imageUrl)
                    throw new Error('DSH 当前仅支持纯文本历史。');
                const content = [{ type: 'text', text: item.content }];
                if (item.role === 'user')
                    append('user/message', createUserMessage({ content, source: { kind: 'user' } }), true);
                else if (item.role === 'assistant')
                    append('assistant/message', { turn: 1, step: 1, message: createAssistantMessage({ content, source: { provider: 'chouyu-history', model: 'unknown' } }), stream: [] }, true);
                else
                    throw new Error('DSH 历史仅支持用户和助手消息，额外系统消息尚未适配。');
            }
            append('step/end', { turn: 1, step: 1 });
            append('turn/end', { turn: 1, reason: { kind: 'completed' } });
            const committed = {};
            const streaming = new Set();
            const key = { requestId: value.requestId, attemptId: value.attemptId };
            if (typeof key.requestId !== 'string' || key.attemptId !== value.sessionId)
                throw new Error('DSH 请求归属无效。');
            const handle = await ctx.agents.create({
                sessionId: value.sessionId, seed, agentOptions: { provider: 'chouyu', model: value.model },
                meta: { cwd: process.env.CHOUYU_DSH_WORKDIR },
                setup(scope) {
                    installBudget(scope, peer, key, value.sessionId, value.maxOutputTokens, Boolean(value.rounds), () => { committed.usageIncomplete = true; });
                    scope.on('session/event', (_session, event) => {
                        if (event.type === 'user/message' && event.data.source?.kind === 'user')
                            committed.input = event;
                        if (event.type === 'assistant/message' && !event.data.interrupted)
                            committed.assistant = event;
                        if (event.type === 'turn/end')
                            committed.turn = event;
                    });
                    scope.systemPrompt.section({ name: 'chouyu', order: 0, text: value.systemPrompt, interpolate: false, complete: true });
                    scope.systemPrompt.context({ name: 'working-directory:current', order: 100, text: '', interpolate: false, required: false });
                    scope.on('system-prompt/assemble', async (_assembly, _context, next) => {
                        const assembly = await next();
                        assembly.contexts = [];
                        return assembly;
                    }, { prepend: true });
                    for (const tool of value.tools)
                        scope.tools.register({
                            name: tool.name, description: tool.description, parameters: tool.inputSchema,
                            output: { schema: { type: 'string' }, render: (_args, result) => [{ type: 'text', text: result }] },
                            execute: (args, exec) => peer.request('tool', { ...key, sessionId: value.sessionId, callId: exec.callId, name: exec.name, args }, { signal: exec.signal })
                        });
                    scope.on('agent/assistant-stream', ({ frame }) => {
                        const pending = peer.request('stream', { ...key, sessionId: value.sessionId, frame }).catch(() => { committed.bridgeError = true; handle.agent.cancel({ kind: 'hook', reason: 'bridge disconnected' }); }).finally(() => streaming.delete(pending));
                        streaming.add(pending);
                    });
                }
            });
            const message = createUserMessage({ content: [{ type: 'text', text: value.prompt }], source: { kind: 'user' } });
            handles.set(value.sessionId, { ...handle, committed, key, streaming, message, budgeted: Boolean(value.rounds) });
            return { sessionId: value.sessionId, inputMessageId: message.id };
        }
        const handle = handles.get(value?.sessionId);
        if (!handle || handle.key.requestId !== value.requestId || handle.key.attemptId !== value.attemptId)
            throw new Error('DSH 请求关联不存在。');
        if (method === 'run') {
            const message = handle.message;
            if (message.content[0].text !== value.prompt || handle.started)
                throw new Error('DSH 输入不可替换或重放。');
            handle.started = true;
            handle.agent.followup(message);
            await handle.agent.whenIdle();
            await Promise.all(handle.streaming);
            if (handle.committed.bridgeError)
                throw new Error('DSH 流传输未完成。');
            const { input, turn, assistant } = handle.committed;
            if (turn?.data.reason?.kind === 'aborted')
                return { state: 'cancelled', error: 'AI 请求已取消。', usageIncomplete: handle.committed.usageIncomplete };
            if (!(turn?.data.reason?.kind === 'completed' || handle.budgeted && turn?.data.reason?.kind === 'max-tokens') || input?.data.id !== message.id || !assistant || assistant.seq <= input.seq)
                return { state: 'failed', error: 'DSH 未提交本次请求的正式回复。', usageIncomplete: handle.committed.usageIncomplete };
            const text = assistant.data.message.content.filter(b => b.type === 'text').map(b => b.text).join('');
            return { state: 'completed', text, committedSeq: assistant.seq, inputMessageId: message.id, usageIncomplete: handle.committed.usageIncomplete };
        }
        if (method === 'cancel') {
            handle.agent.cancel({ kind: 'user' });
            await handle.agent.whenIdle();
            return true;
        }
        if (method === 'flush')
            return ctx.sessions.flush(handle.agent.session);
        if (method === 'dispose') {
            await handle.dispose();
            handles.delete(value.sessionId);
            return true;
        }
        throw new Error('DSH 控制方法无效。');
    }, () => { for (const handle of handles.values())
        handle.agent.cancel({ kind: 'hook', reason: 'bridge disconnected' }); });
    await peer.request('hello', { role: 'plugin', token: process.env.CHOUYU_DSH_TOKEN }, { timeoutMs: 10000 });
    ctx.on('dispose', async () => { for (const handle of handles.values())
        await handle.dispose(); peer.close(); });
}
