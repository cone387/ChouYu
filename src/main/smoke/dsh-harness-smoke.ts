import { app, type BrowserWindow } from 'electron';
import { createServer, type ServerResponse } from 'node:http';
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCharacter, createChatSession, listCharacters, getCharacter, getConfig, getSession, getSessions, saveConfig, selectChatSession, flushDatabase } from '../database';
import { contactAgentsCall, pendingContactInteractions } from '../agents';
import { waitForRenderer } from './storage-smoke';
import { dshService } from '../harness/service';
import type { MaterialVersion } from '../../shared/contact-materials';
import type { ContactActionInteraction } from '../../shared/contact-actions';
/** Actual renderer, IPC, pinned SDK, registered tools, persistent card and business storage. */
export async function runDshHarnessSmoke(window: BrowserWindow) {
    if (process.env.CHOUYU_SMOKE_TEST !== '1')
        throw new Error('Isolated smoke only');
    const original = getConfig(), originalSession = (await window.webContents.executeJavaScript('window.electronAPI.db.getSessionWorkspace()')).activeSession.id;
    let material: MaterialVersion, toolStep = 0, providerCalls = 0, routeCalls = 0, holdFinal = false, pendingFinal: ServerResponse | undefined;
    let mode: 'tools' | 'plain' = 'tools', desiredDensity = 'compact';
    let holdRoute = false, pendingRoute: ServerResponse | undefined;
    const requests: any[] = [];
    const send = (res: ServerResponse, delta: unknown, finish: string | null = null) => res.write(`data: ${JSON.stringify({ id: 'smoke-message', object: 'chat.completion.chunk', created: 1, model: 'dsh-smoke', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    const finish = (res: ServerResponse, text: string) => { send(res, { content: text }); send(res, {}, 'stop'); res.end(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 } })}\n\ndata: [DONE]\n\n`); };
    const server = createServer(async (req, res) => {
        if (req.method !== 'POST') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ data: [{ id: 'dsh-smoke' }] }));
            return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of req)
            chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        if (body.messages.some((m: any) => typeof m.content === 'string' && m.content.includes('判断用户最新一句是否在调整'))) {
            routeCalls++;
            if (holdRoute) { pendingRoute = res; return; }
            finish(res, JSON.stringify({ kind: 'none' }));
            return;
        }
        providerCalls++;
        requests.push(body);
        if (mode === 'plain') {
            finish(res, 'DSH 普通对话验收通过。');
            return;
        }
        const toolNames = ['read_contact_material', 'get_contact_output_preferences', 'set_contact_output_preference'];
        if (toolStep < 3) {
            const step = toolStep++, name = toolNames[step];
            const pref = body.messages.filter((m: any) => m.role === 'tool').at(-1);
            const args = step === 0 ? { id: material.id, version: material.version } : step === 1 ? { scope: 'contact' } : { scope: 'contact', revision: JSON.parse(pref.content).revision, reason: '用户验收授权', density: desiredDensity };
            send(res, { role: 'assistant', tool_calls: [{ index: 0, id: `call-${step}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
            send(res, {}, 'tool_calls');
            res.end('data: [DONE]\n\n');
            return;
        }
        if (holdFinal) {
            pendingFinal = res;
            return;
        }
        finish(res, '已读取验收资料，并根据原确认事项的实际回执完成回复。');
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const address = server.address() as {
        port: number;
    };
    const run = (script: string) => window.webContents.executeJavaScript(script);
    const click = (selector: string) => run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled)throw new Error('Missing enabled control: '+${JSON.stringify(selector)});el.click()})()`);
    const until = async (check: () => boolean | Promise<boolean>, label: string, timeout = 60000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) {
        if (await check())
            return;
        await new Promise(r => setTimeout(r, 50));
    } throw new Error(`DSH smoke timed out: ${label}`); };
    try {
        saveConfig({ provider: 'openai', baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'synthetic-dsh-key', model: 'dsh-smoke', memoryEnabled: false, aiToolsEnabled: true, toolPermissionMode: 'auto' });
        const template = listCharacters().find(c => !c.builtIn)!;
        const character = createCharacter({ ...template, name: 'DSH 接入验收', soulMd: '独立联系人，只依据提供的资料交流。', model: 'dsh-smoke' });
        const session = createChatSession('DSH 接入验收', character.id).activeSession.id;
        material = await contactAgentsCall(character.id, 'saveMaterial', [{ name: '验收资料', scope: { kind: 'contact' }, content: '资料正文：蓝色火车在周三抵达。这是隔离验收数据。', source: { kind: 'text', label: '验收' } }]);
        window.webContents.send('config:changed', getConfig());
        window.webContents.send('characters:changed');
        window.webContents.send('sessions:changed');
        await run("window.electronAPI.db.setState('workspace-active-page','chat')");
        window.webContents.send('open-chat-panel');
        await waitForRenderer(window, "Boolean(document.querySelector('.chat-panel[data-ready=true]'))", 15000);
        const artifacts = process.env.CHOUYU_SMOKE_ARTIFACTS || join(app.getPath('userData'), 'dsh-acceptance');
        mkdirSync(artifacts, { recursive: true });
        const openEngineForm = async (id: string) => {
            await click('[data-workspace-nav=contacts]');
            await waitForRenderer(window, `Boolean(document.querySelector('[data-contacts-card-detail="${id}"]'))`, 15000);
            await click(`[data-contacts-card-detail="${id}"]`);
            await click(`[data-contacts-edit="${id}"]`);
            await waitForRenderer(window, "Boolean(document.querySelector('[data-contacts-harness]'))", 15000);
        };
        const saveEngine = async (engine: 'legacy' | 'dsh') => {
            await run(`(()=>{const el=document.querySelector('[data-contacts-harness]');el.value=${JSON.stringify(engine)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
            await click('[data-contacts-save]');
            await waitForRenderer(window, "!document.querySelector('[data-contacts-form]')", 15000);
        };
        // Select the engine through the real per-contact editor, never a startup switch.
        await openEngineForm(character.id);
        if (await run("document.querySelector('[data-contacts-harness]').value") !== 'legacy') throw new Error('New contact did not default to native');
        // A change while the original intent route is pending affects only the next request.
        mode = 'plain'; holdRoute = true;
        const inFlight = run(`window.electronAPI.ai.startStream(${JSON.stringify({ requestId: 'engine-before-route', systemPrompt: '独立联系人', characterId: character.id, sessionId: session, messages: [{ role: 'user', content: '你好，先聊一会儿' }] })})`);
        await until(() => Boolean(pendingRoute), 'pending intent route before engine change');
        await saveEngine('dsh');
        holdRoute = false; finish(pendingRoute!, JSON.stringify({ kind: 'none' })); pendingRoute = undefined;
        const prior = await inFlight;
        if (!prior.ok || prior.harnessSource || dshService().store.all().length) throw new Error('Settings changed the engine of an already started request: ' + JSON.stringify(prior));
        mode = 'tools';
        if (getCharacter(character.id)?.harnessEngine !== 'dsh' || (getCharacter('chouyu')?.harnessEngine ?? 'legacy') !== 'legacy') throw new Error('Contact selection was not saved independently');
        await openEngineForm(character.id);
        if (await run("document.querySelector('[data-contacts-harness]').value") !== 'dsh') throw new Error('Reopened editor lost engine selection');
        await run("document.querySelector('[data-contacts-harness]').focus()");
        writeFileSync(join(artifacts, 'contact-engine-settings.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        await run("document.querySelector('[data-contacts-form]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
        await openEngineForm('chouyu');
        await saveEngine('dsh');
        if (getCharacter('chouyu')?.harnessEngine !== 'dsh' || getCharacter(character.id)?.harnessEngine !== 'dsh') throw new Error('Built-in contact engine was not saved independently');
        await openEngineForm('chouyu');
        await saveEngine('legacy');
        await run("document.querySelector('[data-workspace-nav=chat]')?.click()");
        const sendUser = async (text: string) => { toolStep = 0; await run(`(()=>{const el=document.querySelector('.input-textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`); await click('[aria-label="发送消息"]'); };
        const card = async () => { const items = await pendingContactInteractions(character.id); return items.find(c => c.kind === 'action' && c.status === 'pending' && (c as ContactActionInteraction).request.sessionId === session) as ContactActionInteraction | undefined; };
        holdFinal = true;
        await sendUser('读取验收资料，确认后把我的阅读间距设为紧凑，并告诉我结果。');
        await until(async () => Boolean(await card()), 'persistent confirmation');
        const pending = (await card())!, before = providerCalls, started = Date.now();
        await click('[aria-label="关闭面板"]');
        await new Promise(r => setTimeout(r, 65000));
        if (providerCalls !== before || (await card())?.id !== pending.id)
            throw new Error('Waiting dispatched inference or lost its original card');
        window.webContents.send('open-chat-panel');
        await waitForRenderer(window, `Boolean(document.querySelector('[data-contact-interaction="${pending.id}"] .primary'))`, 15000);
        await click(`[data-contact-interaction="${pending.id}"] .primary`);
        await until(() => Boolean(pendingFinal), 'post-receipt model call');
        const saved = await contactAgentsCall<ContactActionInteraction>(character.id, 'getInteraction', [pending.id]);
        if (saved.status !== 'resolved' || !saved.outcome)
            throw new Error('Original saved action receipt missing');
        if (!JSON.stringify(requests.at(-1)).includes(saved.outcome.content.replaceAll('"', '\\"'))) {
            const toolResults = requests.at(-1).messages.filter((m: any) => m.role === 'tool').map((m: any) => m.content);
            if (!toolResults.includes(saved.outcome.content))
                throw new Error('DSH did not receive original saved receipt');
        }
        await click('[aria-label="关闭面板"]');
        finish(pendingFinal!, '已读取蓝色火车资料，阅读偏好已保存。');
        pendingFinal = undefined;
        await until(() => Boolean(getSession(session)?.messages.some(m => m.harnessSource?.engine === 'dsh' && m.replyCompletedAt)), 'saved DSH message');
        const replies = getSession(session)!.messages.filter(m => m.harnessSource?.engine === 'dsh');
        if (replies.length !== 1 || !getSessions().find(s => s.id === session)?.unreadCount)
            throw new Error('Hidden completion duplicated or did not remain unread');
        const preferences = await contactAgentsCall<any[]>(character.id, 'outputPreferenceCatalogue');
        if (preferences.find(p => p.scope.kind === 'contact')?.preference.density !== 'compact')
            throw new Error('Original preference store did not change');
        await run(`window.electronAPI.agents.submitInteraction(${JSON.stringify(character.id)},${JSON.stringify(pending.id)},{version:${JSON.stringify(pending.version)},actionId:'apply'})`);
        if (JSON.stringify(await contactAgentsCall(character.id, 'outputPreferenceCatalogue')) !== JSON.stringify(preferences))
            throw new Error('Duplicate click wrote the preference again');
        if (!JSON.stringify(requests).includes('蓝色火车'))
            throw new Error('Material body did not reach the model');
        const source = replies[0].harnessSource!, record = dshService().store.get(source);
        if (record?.state !== 'completed' || !record.durable || dshService().store.tools(source).length !== 1)
            throw new Error('Missing durable execution/card association');
        mode = 'plain';
        holdFinal = false;
        window.webContents.send('open-chat-panel');
        await waitForRenderer(window, "Boolean(document.querySelector('.input-textarea'))", 15000);
        await sendUser('普通聊天验收：你好。');
        await until(() => Boolean(getSession(session)?.messages.some(m => m.content === 'DSH 普通对话验收通过。' && m.replyCompletedAt)), 'ordinary chat');
        mode = 'tools';
        desiredDensity = 'comfortable';
        await sendUser('读取资料并准备调整间距，这次我会拒绝。');
        await until(async () => Boolean(await card()), 'rejection card');
        const rejected = (await card())!;
        await waitForRenderer(window, `Boolean(document.querySelector('[data-contact-interaction="${rejected.id}"] button'))`, 15000);
        await run(`(()=>{const card=document.querySelector('[data-contact-interaction="${rejected.id}"]');[...card.querySelectorAll('button')].find(b=>b.textContent==='拒绝').click()})()`);
        await until(() => dshService().store.all().filter(r => r.characterId === character.id && r.state === 'completed').length === 3, 'rejected tool receipt');
        if (JSON.stringify(await contactAgentsCall(character.id, 'outputPreferenceCatalogue')) !== JSON.stringify(preferences))
            throw new Error('Rejection changed the preference');
        await waitForRenderer(window, "!document.querySelector('[aria-label=\"停止生成\"]')", 15000);
        await sendUser('准备调整间距，随后验证停止本次请求。');
        await until(async () => Boolean(await card()), 'cancellation card');
        const stopped = (await card())!;
        await click('[aria-label="停止生成"]');
        await until(async () => (await contactAgentsCall<ContactActionInteraction>(character.id, 'getInteraction', [stopped.id])).status === 'obsolete', 'cancelled card invalidation');
        const late = await run(`window.electronAPI.agents.submitInteraction(${JSON.stringify(character.id)},${JSON.stringify(stopped.id)},{version:${JSON.stringify(stopped.version)},actionId:'apply'}).then(()=>false,()=>true)`);
        if (!late || JSON.stringify(await contactAgentsCall(character.id, 'outputPreferenceCatalogue')) !== JSON.stringify(preferences))
            throw new Error('Late response replayed a cancelled write');
        await openEngineForm(character.id);
        await saveEngine('legacy');
        mode = 'plain';
        const attempts = dshService().store.all().length, callsBeforeNative = providerCalls;
        const native = await run(`window.electronAPI.ai.startStream(${JSON.stringify({ requestId: 'native-after-switch', systemPrompt: '独立联系人', characterId: character.id, sessionId: session, messages: [{ role: 'user', content: '切回原生后打个招呼' }] })})`);
        if (!native.ok || native.harnessSource || dshService().store.all().length !== attempts || providerCalls !== callsBeforeNative + 1) throw new Error('Switching back did not use native without restart: ' + JSON.stringify(native));
        await click('[data-workspace-nav=chat]');
        const report = { dshVersion: record.version, perContactSettings: true, builtInSettings: true, inFlightEngineStable: true, nativeSwitchBack: true, ordinaryChat: true, readMaterial: true, originalCard: pending.id, waitMs: Date.now() - started, providerCalls, routeCalls, hiddenUnread: true, source, originalPreference: true, rejection: true, duplicateClick: true, stopInvalidatesCard: true };
        writeFileSync(join(artifacts, 'dsh-acceptance.json'), JSON.stringify(report, null, 2));
        writeFileSync(join(artifacts, 'dsh-chat.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        console.log('CHOUYU_DSH_SMOKE_PASSED', JSON.stringify(report));
    }
    catch (error) {
        const home = join(app.getPath('userData'), 'harness', 'logs');
        try {
            for (const entry of readdirSync(home, { recursive: true, withFileTypes: true }).filter(e => e.name === 'session.v4.jsonl')) {
                const lines = readFileSync(join(entry.parentPath, entry.name), 'utf8').trim().split('\n');
                console.error('DSH_EVENT_TRACE', JSON.stringify(lines.slice(-15).map(line => { const e = JSON.parse(line); return { type: e.type, seq: e.seq, reason: e.data?.reason, error: e.data?.error }; })));
            }
        }
        catch { }
        console.error('DSH_SMOKE_DIAGNOSTIC', JSON.stringify({ providerCalls, routeCalls, toolStep, runs: dshService().store.all(), ui: await run('document.body.innerText.slice(-7000)') }));
        throw error;
    }
    finally {
        pendingRoute?.end();
        pendingFinal?.end();
        server.closeAllConnections();
        await new Promise<void>(r => server.close(() => r()));
        await run("document.querySelector('[aria-label=\"关闭面板\"]')?.click()");
        saveConfig(original);
        selectChatSession(originalSession);
        flushDatabase();
    }
}
