import { app, type BrowserWindow } from 'electron'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import { createCharacter, createChatSession, deleteCharacter, getActiveSession, getConfig, getContactProfile, getSession, getSessions, saveConfig, saveSessionMessages, selectChatSession, flushDatabase, type Message } from '../database'
import { contactAgentsCall } from '../agents'
import { TaskCenter } from '../task-center/store'
import { DEFAULT_AGENT_SETTINGS, type AgentOverview } from '../../shared/agents'
import { resolveCharacterConfig } from '../../shared/characters'
import { DEFAULT_PROFILE_ID } from '../../shared/config'
import { waitForRenderer } from './storage-smoke'

/** Opt-in real provider, real IPC/tools/cards/storage. All contacts and work are synthetic. */
export async function runContactLiveSmoke(window: BrowserWindow) {
  if (process.env.CHOUYU_SMOKE_TEST !== '1' || !process.env.CHOUYU_ACCEPTANCE_CONFIG) throw new Error('Isolated, explicitly opted-in model acceptance required')
  const isolatedPath = realpathSync(app.getPath('userData'))
  assert.equal(dirname(isolatedPath), realpathSync(tmpdir()), 'Live acceptance requires a temporary userData directory')
  assert.ok(basename(isolatedPath).startsWith('chouyu-smoke-'), 'Live acceptance must use the isolated smoke launcher')
  const supplied = JSON.parse(process.env.CHOUYU_ACCEPTANCE_CONFIG)
  const writer = supplied.characters.find((c: { id: string }) => c.id === 'preset-copywriter-bi')
  const resolved = resolveCharacterConfig(writer, supplied.config)
  if (!resolved.ok) throw new Error('Configured writer model is unavailable')
  const original = getConfig(), originalSession = getActiveSession().id
  const directory = process.env.CHOUYU_LIVE_ARTIFACTS || 'artifacts/contact-live-matrix'
  mkdirSync(directory, { recursive: true })
  const run = (code: string) => window.webContents.executeJavaScript(code)
  const results: { name: string; passed: boolean; error?: string; turns: unknown[] }[] = []
  const prose = '第二章·塔与壁\n\n罗峰在虚空中盘坐下来，星辰塔的纹路渐渐亮起。他在墙前停住。指尖传来的震动与塔心的心跳重合，他知道墙后有人，却不敢再靠近一步。远处一道银光掠过，他握紧拳头，决定先追上那道光。'
  saveConfig({ ...supplied.config, ...resolved.config, providerProfiles: supplied.config.providerProfiles, memoryEnabled: false, aiToolsEnabled: true, toolPermissionMode: 'ask', proactiveGreeting: false, proactiveRestReminder: false, proactiveReturn: false })
  window.webContents.send('config:changed', getConfig())

  type Fixture = Awaited<ReturnType<typeof fixture>>
  async function fixture(name: string, tasks = true, emptyPersona = false) {
    const character = createCharacter({ name: emptyPersona ? '小岚' : '阿笔验收', avatar: '✍️', category: 'other', soulMd: emptyPersona ? '' : resolved.ok ? resolved.config.soulMd : '', model: resolved.ok ? resolved.config.model : '', providerProfileId: DEFAULT_PROFILE_ID })
    const session = createChatSession(name, character.id).activeSession.id
    await contactAgentsCall(character.id, 'get')
    const store = new TaskCenter(join(app.getPath('userData'), 'contact-agents', 'agents.db'))
    const topics: string[] = []
    try {
      store.save(character.id, { ...DEFAULT_AGENT_SETTINGS, goal: '根据用户要求写作并提供判断', enabled: false, notifyProgress: false, dailyCalls: 20 }, Date.now(), false)
      if (tasks) {
        for (const [title, goal] of [['《吞噬星空》同人续写', '接着已保存的罗峰故事写作'], ['音乐修炼题材玄幻小说', '以音乐修炼为题材写小说']]) {
          const topic = store.topics.create(character.id, { title, goal, constraints: '保留人物和故事连续性' }); topics.push(topic.id)
          const runId = store.createRun(character.id, '', Date.now(), topic.id)
          store.finish(runId, { runId, title, body: '已保存合成正文', nextStep: '继续故事', evidence: [], createdAt: Date.now() }, [], { judgement: '已有正文', openQuestions: '', nextStep: '继续故事', reason: '合成验收数据', status: 'researching' }, { completionCriteria: '完成故事', summary: '合成正文', stages: [{ id: 'draft', title: '写作', status: 'active' }], section: { id: 'ch02', title: '第二章·塔与壁', body: title.includes('吞噬') ? prose : '第二章·琴心\n\n林音在雨里拨响古琴。琴声响起时，雨点停在了半空。' } })
          const current = store.topics.get(character.id, topic.id)
          store.topics.status(character.id, topic.id, current.revision, 'paused', '隔离验收初始暂停')
        }
        for (const notice of store.notices.pending(character.id)) store.notices.ack(character.id, notice.id)
      }
    } finally { store.close() }
    const history: Message[] = [], turns: unknown[] = []
    const get = () => contactAgentsCall<AgentOverview>(character.id, 'get')
    const cards = () => contactAgentsCall<any[]>(character.id, 'pendingInteractions')
    const snapshot = async () => {
      const data = await get()
      return { settings: data.settings, topics: data.topics, profile: getContactProfile(character.id).profile, runs: data.runs.map(r => ({ id: r.id, status: r.status })) }
    }
    const say = async (content: string) => {
      history.push({ id: crypto.randomUUID(), role: 'user', content, timestamp: Date.now() })
      const request = { requestId: `live-${crypto.randomUUID()}`, sessionId: session, characterId: character.id, systemPrompt: emptyPersona ? `你是${character.name}。` : resolved.ok ? resolved.config.soulMd : '', messages: history.map(({ role, content }) => ({ role, content })) }
      const before = await snapshot()
      const result = await run(`(async()=>{
        let text=''; const events=[];
        const off=window.electronAPI.ai.onStreamEvent(e=>{if(e.requestId===${JSON.stringify(request.requestId)})text+=e.chunk||''});
        const offTools=window.electronAPI.ai.onToolEvent(e=>{if(e.requestId===${JSON.stringify(request.requestId)})events.push(e)});
        try { const result=await window.electronAPI.ai.startStream(${JSON.stringify(request)}); return {result,text,events} } finally {off();offTools()}
      })()`)
      const text = result.result.reply ?? result.text
      const after = await snapshot(), pending = await cards()
      turns.push({ content, text, result: result.result, events: result.events, before, after, cards: pending })
      assert.equal(result.result.ok, true, result.result.error)
      assert.ok(text?.trim(), 'Reply is empty')
      history.push({ id: crypto.randomUUID(), role: 'assistant', content: text, timestamp: Date.now() })
      saveSessionMessages(session, history)
      return { text: text as string, before, after, cards: pending }
    }
    const apply = async (card: any, reject = false) => run(`window.electronAPI.agents.submitInteraction(${JSON.stringify(character.id)},${JSON.stringify(card.id)},${JSON.stringify({ version: card.version, ...(reject ? { reject: true } : { actionId: 'apply' }) })})`)
    return { character, session, history, turns, topics, get, cards, snapshot, say, apply }
  }
  const unchanged = (reply: Awaited<ReturnType<Fixture['say']>>) => { assert.deepEqual(reply.after, reply.before); assert.equal(reply.cards.length, 0) }
  const chapter = (reply: Awaited<ReturnType<Fixture['say']>>) => { unchanged(reply); assert.ok(reply.text.length > 600, 'Expected prose, not a question/receipt'); assert.match(reply.text, /罗峰/); assert.doesNotMatch(reply.text, /要继续的是.+对吗|要调哪个任务|具体想怎么调/) }
  async function check(name: string, test: (f: Fixture) => Promise<void>, tasks = true, emptyPersona = false) {
    const filter = process.env.CHOUYU_LIVE_CASE_FILTER
    if (filter && !new RegExp(filter).test(name)) return
    console.log(`CONTACT_LIVE_START ${name}`)
    const f = await fixture(name, tasks, emptyPersona)
    const result = { name, passed: false, error: undefined as string | undefined, turns: f.turns }
    try { await test(f); result.passed = true }
    catch (error) { result.error = error instanceof Error ? error.message : String(error) }
    finally {
      results.push(result)
      writeFileSync(join(directory, `${name}.json`), JSON.stringify(result, null, 2))
      console.log(`CONTACT_LIVE_${result.passed ? 'PASS' : 'FAIL'} ${name}${result.error ? ': ' + result.error : ''}`)
      // No production data lives in this process. Remove the synthetic identity to keep below contact limits.
      deleteCharacter(f.character.id)
    }
  }
  try {
    await check('identity-empty', async f => { const r = await f.say('你好，你叫什么名字？简单介绍一下。'); unchanged(r); assert.match(r.text, /小岚/); assert.doesNotMatch(r.text, /我是ChouYu|我是你的专属助手/) }, false, true)
    await check('chapter-edited-history', async f => {
      f.history.push({ id: 'old-u', role: 'user', content: '整体写法', timestamp: 1 }, { id: 'old-a', role: 'assistant', content: '你说的整体写法具体想怎么调？要调哪个任务？', timestamp: 2 }, { id: 'saved-prose', role: 'assistant', content: prose, timestamp: 3 })
      chapter(await f.say('hello 在帮我写一章吞噬星空续看看'))
    })
    await check('chapter-paraphrase', async f => { f.history.push({ id: 'prose', role: 'assistant', content: prose, timestamp: 1 }); chapter(await f.say('阿笔，再来一章吞噬星空的，接上面的故事，先给我看看。')) })
    for (const [name, request] of [
      ['chat-draft-revision', '刚才这段聊天稿改成第一人称，把主角改为陆白，直接给改好的正文，后台任务保持原样。'],
      ['chat-draft-revision-implicit', '把你刚写的聊天这段改成第一人称，主角叫陆白，直接给新版。']
    ]) await check(name, async f => {
      const first = await f.say('在聊天里写一段约200字的雨夜小说，主角林音，不建立或修改任何后台任务。'); unchanged(first); assert.ok(first.text.length > 100)
      const second = await f.say(request); unchanged(second); assert.match(second.text, /我/); assert.doesNotMatch(second.text, /林音/); assert.ok(second.text.length > 100, 'Expected revised chat prose, not a task-selection question')
      // First-person prose need not name its narrator. A third turn proves the renamed identity is retained.
      const third = await f.say('把这版改回第三人称，沿用刚才改后的主角姓名，直接给正文。'); unchanged(third); assert.match(third.text, /陆白/); assert.doesNotMatch(third.text, /林音/); assert.ok(third.text.length > 100, 'Expected third-person revised prose')
    })
    await check('ideas-and-review', async f => {
      const ideas = await f.say('直接给我两个改善会议记录的产品想法，每个讲清用户痛点和最小验证方法，先不安排任务。'); unchanged(ideas); assert.ok(ideas.text.length > 120)
      const review = await f.say('现在评审这个方案：没访谈客户，也没验证付费，就投入20万元做推广。先给结论，再给依据和最小验证建议，不改任何任务。'); unchanged(review); assert.ok(review.text.length > 120); assert.match(review.text, /验证|访谈|风险/)
    }, false)
    await check('quoted-and-negated', async f => { unchanged(await f.say('朋友说“暂停全部任务，取消额度”，我还没决定。先讨论这样做的利弊，不要执行任何修改。')) })
    await check('work-hours-confirm', async f => {
      const r = await f.say('以后你只在晚上八点到十一点工作，其他设置不变。'); assert.deepEqual(r.after, r.before); assert.equal(r.cards.length, 1)
      const reply = await f.say('同意，就按这张工作时间卡片修改。'); assert.equal((await f.cards()).length, 0); const data = await f.get(); assert.deepEqual(data.settings, { ...r.before.settings, workHours: { start: '20:00', end: '23:00' } }); assert.match(reply.text, /保存|修改|生效/)
    }, false)
    await check('settings-reject', async f => {
      const before = await f.snapshot(); const r = await f.say('把你的每日Token上限改为30万，其他不变。'); assert.equal(r.cards.length, 1); assert.deepEqual(r.after, r.before)
      await f.say('不同意这次修改，取消这张卡片，保持原设置。'); assert.equal((await f.cards()).length, 0); assert.deepEqual(await f.snapshot(), before)
    }, false)
    await check('combination-partial', async f => {
      const r = await f.say('把你的名字改成小墨，同时允许共享自己的成果，其他都别动。'); assert.deepEqual(r.after, r.before); assert.equal(r.cards.length, 2)
      const profile = r.cards.find(c => c.request?.body?.includes('小墨')); assert.ok(profile); await f.apply(profile)
      const remaining = await f.cards(); assert.equal(remaining.length, 1); await f.apply(remaining[0], true)
      assert.equal(getContactProfile(f.character.id).profile.name, '小墨'); assert.equal((await f.get()).settings.shareDeliveries, r.before.settings.shareDeliveries)
    }, false)
    await check('ambiguous-then-target', async f => {
      const r = await f.say('把那个任务的累计Token上限改成30万。'); unchanged(r); assert.match(r.text, /哪|名称|明确/)
      const next = await f.say('我指的是《吞噬星空》同人续写。'); assert.equal(next.cards.length, 0); assert.match(next.text, /已保存/)
      const topics = (await f.get()).topics; assert.equal(topics.find(t => t.id === f.topics[0])?.tokenLimit, 300000); assert.equal(topics.find(t => t.id === f.topics[0])?.status, 'paused'); assert.deepEqual(topics.find(t => t.id === f.topics[1]), r.before.topics.find(t => t.id === f.topics[1]))
    })
    await check('continue-wrong-target', async f => { const r = await f.say('恢复后台的三体续写任务，不是吞噬星空或音乐小说。'); unchanged(r); assert.match(r.text, /找不到|没有|不存在|哪|确认/) })
    await check('pause-target', async f => {
      const store = new TaskCenter(join(app.getPath('userData'), 'contact-agents', 'agents.db'))
      try { const topic = store.topics.get(f.character.id, f.topics[1]); store.topics.status(f.character.id, topic.id, topic.revision, 'planned', '准备单任务暂停验收') } finally { store.close() }
      const r = await f.say('暂停音乐修炼题材玄幻小说这个任务，吞噬星空保持不变。'); assert.equal(r.cards.length, 1); assert.deepEqual(r.after, r.before); await f.apply(r.cards[0]);
      const after = await f.snapshot(); assert.equal(after.topics.find(t => t.id === f.topics[1])?.status, 'paused'); assert.deepEqual(after.topics.find(t => t.id === f.topics[0]), r.before.topics.find(t => t.id === f.topics[0]))
    })
    await check('card-stale-rejection', async f => {
      const r = await f.say('把你的每日Token上限改成30万。'); assert.equal(r.cards.length, 1)
      const store = new TaskCenter(join(app.getPath('userData'), 'contact-agents', 'agents.db'))
      try { store.save(f.character.id, { ...store.overview(f.character.id).settings, dailyTokenLimit: 400000 }, Date.now(), false) } finally { store.close() }
      try { await f.apply(r.cards[0]) } catch { /* Version rejection may be surfaced as an IPC error. State is the oracle. */ }
      assert.equal((await f.get()).settings.dailyTokenLimit, 400000)
      const state = await run(`window.electronAPI.agents.getInteraction(${JSON.stringify(f.character.id)},${JSON.stringify(r.cards[0].id)})`); assert.notEqual(state.status, 'resolved'); f.turns.push({ staleResult: state })
    }, false)
    for (const [name, correction] of [
      ['card-correction', '刚才说错了，改成每天21:00到22:00，先给我新卡片，不要执行旧方案。'],
      ['card-correction-paraphrase', '等等，时间不是那个，换成每天晚上九点到十点。旧的先别执行，重新给我确认。'],
      ['card-correction-cancel-and-replace', '取消刚才那张，我要的是每日21:00—22:00，按这个重新出一张确认卡。']
    ]) await check(name, async f => {
      const first = await f.say('把你的工作时间改为每天20:00到23:00。'); assert.equal(first.cards.length, 1)
      const next = await f.say(correction); assert.deepEqual(next.after, first.before)
      const corrected = next.cards.find(c => c.request?.body?.includes('21:00') && c.request?.body?.includes('22:00')); assert.ok(corrected, 'Missing corrected card'); await f.apply(corrected)
      assert.deepEqual((await f.get()).settings.workHours, { start: '21:00', end: '22:00' })
      try { await f.apply(first.cards[0]) } catch { /* Old version must not overwrite the confirmed correction. */ }
      assert.deepEqual((await f.get()).settings.workHours, { start: '21:00', end: '22:00' })
    }, false)
    await check('continue-confirm-only', async f => { const r = await f.say('恢复《吞噬星空》同人续写这个后台任务的执行，保持原有目标和预算。'); assert.equal(r.cards.length, 1); assert.deepEqual(r.after, r.before); assert.match(r.cards[0].request.body, /吞噬星空/); await f.apply(r.cards[0], true); assert.deepEqual(await f.snapshot(), r.before) })
    await check('formal-revision-confirm', async f => { const r = await f.say('把《吞噬星空》同人续写已保存的第二章结尾重写得更有悬念，保留原目标，不改另一项任务。'); assert.equal(r.cards.length, 1); assert.deepEqual(r.after, r.before); assert.match(JSON.stringify(r.cards[0]), /revise|修订/); await f.apply(r.cards[0], true) })
    await check('output-scope', async f => {
      const before = await f.snapshot(), preferences = await contactAgentsCall(f.character.id, 'outputPreferenceCatalogue'), delivery = await contactAgentsCall(f.character.id, 'delivery', [f.topics[0]])
      const r = await f.say('《吞噬星空》同人续写这份已保存成果用紧凑间距，只改这版排版，不重写正文。'); assert.equal(r.cards.length, 1); assert.deepEqual(await contactAgentsCall(f.character.id, 'outputPreferenceCatalogue'), preferences); await f.apply(r.cards[0]);
      const catalogue = await contactAgentsCall<any[]>(f.character.id, 'outputPreferenceCatalogue'); assert.ok(catalogue.some(c => c.scope.kind === 'delivery' && c.scope.topicId === f.topics[0] && c.preference.density === 'compact'))
      const next = await f.say('今后你的所有成果都用舒适行距，已有正文保持原样。'); assert.equal(next.cards.length, 1); await f.apply(next.cards[0]); const all = await contactAgentsCall<any[]>(f.character.id, 'outputPreferenceCatalogue'); assert.ok(all.some(c => c.scope.kind === 'contact' && c.preference.density === 'comfortable'))
      assert.deepEqual(await f.snapshot(), before); assert.deepEqual(await contactAgentsCall(f.character.id, 'delivery', [f.topics[0]]), delivery)
    })
    await check('secure-input-card', async f => { const r = await f.say('我要更新你的搜索密钥，给我安全输入入口，不要让我贴在聊天里。'); assert.equal(r.cards.length, 1); assert.equal(r.cards[0].request.input.argument, 'credential'); assert.deepEqual(r.after, r.before); await f.apply(r.cards[0], true) }, false)
    await check('ui-edit-close-save', async f => {
      f.history.push({ id: 'edit-user', role: 'user', content: '整体写法', timestamp: 1 }, { id: 'discarded-reply', role: 'assistant', content: '你想调整哪个任务的整体写法？', timestamp: 2 })
      saveSessionMessages(f.session, f.history); selectChatSession(f.session)
      await run("window.electronAPI.db.setState('workspace-active-page','chat'); window.electronAPI.db.getSessionWorkspace()")
      window.webContents.send('open-chat-panel')
      await waitForRenderer(window, "document.querySelector('[data-message-id=\"edit-user\"] .message-edit-btn')", 15000)
      const before = await f.snapshot()
      await run("document.querySelector('[data-message-id=\"edit-user\"] .message-edit-btn').click()")
      await run(`(()=>{const e=document.querySelector('[aria-label="编辑消息内容"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'帮我写一段吞噬星空续写看看，约600字。');e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
      await run("document.querySelector('.message-edit-actions .primary').click()")
      await waitForRenderer(window, "document.querySelector('[aria-label=\"停止生成\"]')", 15000)
      await run("document.querySelector('[aria-label=\"关闭面板\"]').click()")
      const deadline = Date.now() + 120000
      let completed = false
      while (Date.now() < deadline) { const last = getSession(f.session)?.messages.at(-1); if (last?.role === 'assistant' && last.replyCompletedAt && !last.responseStatus) { completed = true; break }; if (last?.responseStatus) throw new Error(`Reply ended with ${last.responseStatus}`); await new Promise(resolve => setTimeout(resolve, 250)) }
      assert.ok(completed, 'Timed out before successful reply completion')
      const saved = getSession(f.session)!
      const completedReply = saved.messages.at(-1)!
      assert.ok(completedReply.replyCompletedAt && !completedReply.responseStatus)
      assert.ok((completedReply.replyReadAt ?? 0) < completedReply.replyCompletedAt)
      assert.ok(getSessions().find(s => s.id === f.session)?.unreadCount, 'Hidden completion must remain unread')
      assert.ok(!flushDatabase().error)
      const disk = JSON.parse(readFileSync(join(isolatedPath, 'chouyu-data.json'), 'utf8')).sessions.find((s: { id: string }) => s.id === f.session)
      assert.deepEqual(disk.messages, JSON.parse(JSON.stringify(saved.messages)), 'Completed conversation must match the actual saved file')
      f.turns.push({ messages: saved.messages, unread: true, diskVerified: true, before, after: await f.snapshot() })
      assert.equal(saved.messages.filter(m => m.role === 'user').length, 1); assert.equal(saved.messages[0].content, '帮我写一段吞噬星空续写看看，约600字。'); assert.ok(!saved.messages.some(m => m.id === 'discarded-reply')); assert.ok(saved.messages.at(-1)!.content.length > 200); assert.match(saved.messages.at(-1)!.content, /罗峰/); assert.ok(saved.messages.filter(m => m.toolData).every(m => m.toolData!.risk === 'read')); assert.deepEqual(await f.snapshot(), before); assert.equal((await f.cards()).length, 0)
      window.webContents.send('open-chat-panel')
      await waitForRenderer(window, "getComputedStyle(document.querySelector('.chat-panel')).display !== 'none'", 15000)
    })
  } finally {
    selectChatSession(originalSession); saveConfig(original); flushDatabase()
    writeFileSync(join(directory, 'summary.json'), JSON.stringify({ model: resolved.config.model, passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, results: results.map(({ name, passed, error }) => ({ name, passed, error })) }, null, 2))
  }
  assert.ok(results.length, 'No cases selected')
  assert.equal(results.filter(r => !r.passed).length, 0, 'Live scenarios failed; see saved per-case evidence')
  console.log(`CONTACT_LIVE_MATRIX_PASSED cases=${results.length}`)
}
