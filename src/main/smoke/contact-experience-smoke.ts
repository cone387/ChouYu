import { app, type BrowserWindow } from 'electron'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { ContactTaskStore } from '../task-center/contact-store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { createCharacter, getConfig, saveConfig, getActiveSession, selectChatSession, flushDatabase, getSessions, getSession } from '../database'
import { restartAgentsForSmoke } from '../agents'
import { contactSkillLibrary } from '../skills'
import { waitForRenderer } from './storage-smoke'
import { handoffSmokeResponse } from './contact-handoff-smoke'
import { deliveryText, textHash } from '../../shared/contact-content'

/** One source identity throughout import, execution, reading, discussion and review. */
export async function runContactExperienceSmoke(window: BrowserWindow, owner: string) {
  const run = (code: string) => window.webContents.executeJavaScript(code)
  const click = async (selector: string) => {
    const point = await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Missing experience control '+${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point }); window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
  }
  const fill = (selector: string, value: string, select = false) => run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${select ? 'HTMLSelectElement' : 'HTMLTextAreaElement'}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('${select ? 'change' : 'input'}',{bubbles:true}))})()`)
  const navigate = (target: unknown) => run(`new Promise((resolve,reject)=>{const detail={target:${JSON.stringify(target)},handled:false,resolve,reject};window.dispatchEvent(new CustomEvent('chouyu:contact-navigation',{detail}));if(!detail.handled)reject(Error('No navigation handler'))})`)
  await run(`window.electronAPI.agents.get(${JSON.stringify(owner)})`)
  const store = new ContactTaskStore(join(app.getPath('userData'), 'contact-agents', 'agents.db')), originalConfig = getConfig(), originalSession = getActiveSession().id
  let material: { id: string; version: number }, topicId = '', initial = true, recoveryUnavailable = false
  let stale: { id: string; revision: number; mode: string; changed: boolean } | undefined
  const requests: { model: string; messages: unknown[] }[] = []
  const prose = '沈青站在雾港，望着周四亮起的蓝色灯光。潮汐带来一封信，她读了很久，才慢慢转身。'
  const server = createServer((request, response) => {
    let body = ''; request.on('data', chunk => { body += chunk }); request.on('end', async () => {
      try {
        const payload = JSON.parse(body), prompt = JSON.stringify(payload.messages); requests.push({ model: payload.model, messages: payload.messages })
        if (recoveryUnavailable && prompt.includes('RECOVERY_SMOKE')) {
          response.writeHead(503, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { message: 'Temporary network outage for recovery fixture' } })); return
        }
        let delta: unknown
        const call = (name: string, args: unknown) => ({ tool_calls: [{ index: 0, id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
        if (prompt.includes('EXPERIENCE_STALE_CONTEXT') && prompt.includes('你只负责路由')) delta = { content: '{"kind":"none"}' }
        else if (prompt.includes('EXPERIENCE_STALE_CONTEXT') && stale) {
          if (!stale.changed) {
            stale.changed = true
            if (stale.mode === 'self') delta = call('update_contact_memory', { id: stale.id, revision: stale.revision, content: 'explicit correction' })
            else {
            if (stale.mode === 'forget') await run(`window.electronAPI.agents.forgetMemory(${JSON.stringify(owner)},${JSON.stringify(stale.id)},${stale.revision})`)
            else await run(`window.electronAPI.agents.updateMemory(${JSON.stringify(owner)},${JSON.stringify(stale.id)},${stale.revision},${JSON.stringify({ content: 'corrected fact', kind: 'preference', scope: { kind: 'contact' }, source: { kind: 'user', at: Date.now() } })})`)
            delta = stale.mode === 'tool' ? call('write_skill_file', { skillId: 'experience-output', path: 'stale.md', content: 'must not be written' }) : { content: 'late obsolete answer' }
            }
          } else delta = { content: 'late obsolete answer' }
        }
        else if (payload.messages.some((message: { role: string; content?: unknown }) => message.role === 'user' && typeof message.content === 'string' && message.content.startsWith('EXPERIENCE_DISCUSSION'))) delta = { content: '蓝色灯光与来信形成了悬念，节奏可以在结尾收紧。' }
        else if (payload.model !== 'review-model' && initial && prompt.includes('正在执行用户交付的写作任务')) {
          const toolMessages = payload.messages.filter((m: { role: string }) => m.role === 'tool')
          if (!toolMessages.length) delta = call('read_contact_material', { id: 'invalid-reference-fixture', version: 999, topicId })
          else if (toolMessages.length === 1) {
            if (JSON.parse(toolMessages[0].content).error?.code !== 'material-reference') throw Error('Invalid reference did not return a bounded repair result')
            delta = call('read_contact_material', { ...material, topicId })
          }
          else if (toolMessages.length === 2) {
            if (JSON.parse(toolMessages[1].content).materialRead?.id !== material.id) throw Error('Corrected reference did not read the actual material')
            delta = call('write_skill_file', { skillId: 'experience-output', path: 'story.md', content: prose })
          }
          else {
            const files = JSON.parse(toolMessages.at(-1).content).files
            const draft = JSON.parse(handoffSmokeResponse(payload)); draft.delivery.section.body = prose; draft.delivery.fileIds = files.map((file: { id: string }) => file.id); draft.body = prose
            delta = { content: JSON.stringify(draft) }
          }
        } else if (initial && payload.model !== 'review-model' && prompt.includes('为联系人的同一个事项安排本轮工作')) delta = { content: JSON.stringify({ action: 'write', reason: '读取设定并创作', urls: [], query: '', checkAfterMinutes: 15 }) }
        else delta = { content: handoffSmokeResponse(payload) }
        response.setHeader('Content-Type', 'text/event-stream'); response.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`)
      } catch (e) { response.statusCode = 500; response.end(String(e)) }
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  try {
    saveConfig({ ...originalConfig, baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'synthetic', aiToolsEnabled: true })
    const reviewer = createCharacter({ name: '整体验收评审者', model: 'review-model', soulMd: '独立评审实际原文。' })
    for (const id of [owner, reviewer.id]) await run(`window.electronAPI.agents.save(${JSON.stringify(id)},${JSON.stringify({ ...DEFAULT_AGENT_SETTINGS, goal: 'Write and review', enabled: false, dailyCalls: 100, shareDeliveries: true, readContactDeliveries: true })})`)
    const topic = store.topics.create(owner, { title: '灯塔整体验收', goal: '读取灯塔设定，写一段正文并保存 story.md，继续保持人物一致。', constraints: '' }, 'user'); topicId = topic.id
    material = await run(`window.electronAPI.agents.importMaterial(${JSON.stringify(owner)},${JSON.stringify({ name: '灯塔设定', content: '雾港灯塔每逢周四亮起蓝色灯光。', scope: { kind: 'task', topicId }, source: { kind: 'text', label: '用户合成设定' } })})`)
    const memory = await run(`window.electronAPI.agents.createMemory(${JSON.stringify(owner)},${JSON.stringify({ content: '本任务主角叫沈青。', kind: 'project', scope: { kind: 'task', topicId }, source: { kind: 'user', at: Date.now() } })})`)
    store.remember(owner, 'EXPERIENCE_PRIVATE_OWNER_MEMORY')
    const root = join(app.getPath('userData'), 'experience-skill'); mkdirSync(root); writeFileSync(join(root, 'SKILL.md'), '---\nname: 整理正文文件\ndescription: 保存实际正文。\n---\n使用 write_skill_file 保存正文到 story.md。')
    const library = contactSkillLibrary(); library.publish('experience-output', root); library.configure(owner, 'experience-output', 'enable', library.list(owner).revision)
    for (const mode of ['update', 'forget', 'tool', 'unrelated', 'self']) {
      const workspace = await run(`window.electronAPI.db.createSession('Stale context regression',${JSON.stringify(owner)})`)
      const sessionId = workspace.activeSession.id
      const memory = await run(`window.electronAPI.agents.createMemory(${JSON.stringify(owner)},${JSON.stringify({ content: 'obsolete fact', kind: 'preference', scope: { kind: 'session', sessionId }, source: { kind: 'user', at: Date.now() } })})`)
      stale = { id: memory.id, revision: 1, mode, changed: false }
      const requestSession = mode === 'unrelated' ? (await run(`window.electronAPI.db.createSession('Unrelated context',${JSON.stringify(owner)})`)).activeSession.id : sessionId
      const result = await run(`window.electronAPI.ai.startStream(${JSON.stringify({ requestId: 'stale-' + mode, characterId: owner, sessionId: requestSession, messages: [{ role: 'user', content: 'EXPERIENCE_STALE_CONTEXT just answer' }], systemPrompt: 'Reply briefly.' })})`)
      if (mode === 'self') {
        if (store.memoryLibrary.get(owner, memory.id).content !== 'obsolete fact') throw Error('Memory changed before the contact action was approved')
        await run(`(async()=>{const card=(await window.electronAPI.agents.pendingInteractions(${JSON.stringify(owner)})).find(c=>c.kind==='action'&&c.request.actions.some(a=>a.tool==='update_contact_memory'&&a.arguments.id===${JSON.stringify(memory.id)}));if(!card)throw Error('Missing memory confirmation card');await window.electronAPI.agents.submitInteraction(card.characterId,card.id,{version:card.version,actionId:'apply'})})()`)
      }
      if (mode === 'unrelated' || mode === 'self') {
        if (!result.ok) throw Error('Valid memory operation failed: ' + JSON.stringify(result))
        if (mode === 'self' && store.memoryLibrary.get(owner, memory.id).content !== 'explicit correction') throw Error('Acknowledged memory tool did not write')
      } else {
        if (result.ok || !stale.changed) throw Error('Stale memory request succeeded: ' + mode)
        if (!/记忆|取消/.test(result.error || '')) throw Error('Unexpected stale request failure: ' + JSON.stringify(result))
      }
      if (store.files.list(owner).some(f => f.name === 'stale.md')) throw Error('Late tool archived obsolete output')
    }
    stale = undefined
    console.log('CHOUYU_CONTEXT_INVALIDATION_PASSED update/forget/late tool')
    if (process.env.CHOUYU_SMOKE_CONTEXT_INVALIDATION_ONLY) return
    await click('[data-agent-tab=portfolio]')
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-portfolio .portfolio-list'))")
    await run(`window.electronAPI.agents.run(${JSON.stringify(owner)},${JSON.stringify(topicId)})`)
    await waitForRenderer(window, `(async()=>{const d=await window.electronAPI.agents.delivery(${JSON.stringify(owner)},${JSON.stringify(topicId)});return d?.version===1})()`, 40000).catch(e => { console.error('EXPERIENCE_RUN', store.overview(owner).runs, requests.map(r => ({ model: r.model, tail: JSON.stringify(r.messages).slice(-900) }))); throw e })
    const first = store.deliveries.get(topicId)!, fileId = first.fileIds?.[0]
    if (!fileId || !first.sections[0].body.includes('沈青')) throw Error('Actual task did not save prose and file')
    if (Buffer.from(store.files.read(owner, fileId).bytes).toString() !== prose) throw Error('Archived bytes mismatch')
    const snapshot = JSON.parse(store.getRun(first.runId)!.input)
    if (!JSON.stringify(snapshot).includes(memory.id) || !JSON.stringify(snapshot).includes(material.id)) throw Error('Task lacks scoped source snapshots')
    await waitForRenderer(window, "Boolean(document.querySelector('[data-portfolio-refresh]'))")
    if (await run(`Boolean(document.querySelector('[data-portfolio-item="${topicId}"]'))`)) throw Error('Portfolio reordered its existing snapshot')
    await click('[data-portfolio-refresh]')
    await waitForRenderer(window, `Boolean(document.querySelector('[data-portfolio-item="${topicId}"]'))`)
    initial = false
    const ref = { characterId: owner, topicId, version: 1, sectionId: 'text' }
    await navigate({ kind: 'delivery', ref }); await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet[open] [data-reading-reference]'))")
    const text = deliveryText(prose)
    store.portfolio.saveReading(owner, { ref, anchor: { start: 0, end: 2, quote: text.slice(0, 2), textHash: textHash(text) }, scrollRatio: 0, updatedAt: Date.now() })
    await restartAgentsForSmoke()
    if (store.portfolio.reading(owner, topicId)?.ref.version !== 1) throw Error('Reading position lost at restart')
    await navigate({ kind: 'delivery', ref }); await waitForRenderer(window, "document.querySelector('.contact-work-sheet[open] .contact-markdown')?.textContent.includes('沈青')")
    await run("(()=>{const p=document.querySelector('.contact-work-sheet[open] .contact-markdown p');const range=document.createRange();range.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(range)})()")
    await click('.contact-work-sheet[open] [data-delivery-discuss]'); await waitForRenderer(window, "Boolean(document.querySelector('.agent-composer-reference'))")
    await fill('.input-textarea', 'EXPERIENCE_DISCUSSION 只讨论这段文字的节奏，不修改。'); await run("document.querySelector('.input-textarea').focus()")
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-citation'))&&!document.querySelector('.agent-composer-reference')")
    await waitForRenderer(window, "document.querySelector('.messages-container')?.textContent.includes('结尾收紧')||document.body.textContent.includes('结尾收紧')")
    await flushDatabase()
    const sent = getSessions().filter(s => s.characterId === owner).flatMap(s => getSession(s.id)?.messages || []).find(m => m.content.includes('EXPERIENCE_DISCUSSION'))
    if (sent?.contactCitations?.[0].ref.version !== 1 || store.deliveries.get(topicId)?.version !== 1) throw Error('Discussion source drift or unintended task mutation')
    await click('.contact-citation button'); await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet[open] [data-delivery-handoff]'))")
    await click('.contact-work-sheet[open] [data-delivery-handoff]'); await waitForRenderer(window, `Boolean(document.querySelector('[data-handoff-recipient] option[value="${reviewer.id}"]'))`)
    await fill('[data-handoff-recipient]', reviewer.id, true); await fill('[data-contact-handoff-dialog] [data-task-description]', '评审这版原文，指出可缩短的句子。'); await click('[data-handoff-save]')
    await waitForRenderer(window, "!document.querySelector('[data-contact-handoff-dialog]')", 20000)
    const handoff = store.handoffs.list(owner, topicId)[0]
    await waitForRenderer(window, `(async()=>{const s=await window.electronAPI.agents.handoffState(${JSON.stringify(owner)},${JSON.stringify(handoff.id)});return s.reviewedVersion===1})()`, 40000)
    if (requests.filter(r => r.model === 'review-model').some(r => JSON.stringify(r.messages).includes('EXPERIENCE_PRIVATE_OWNER_MEMORY'))) throw Error('Private memory crossed review boundary')
    await navigate({ kind: 'delivery', ref: { characterId: reviewer.id, topicId: handoff.topicId, version: 1 } }); await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet[open] [data-return-review]'))")
    await run("document.querySelector('.contact-work-sheet[open] .delivery-reader details').open=true")
    await click('.contact-work-sheet[open] [data-delivery-source]')
    await waitForRenderer(window, `(()=>{const r=document.querySelector('.contact-work-sheet[open] [data-reading-reference]');if(!r)return false;const ref=JSON.parse(r.dataset.readingReference);return ref.characterId===${JSON.stringify(owner)}&&ref.topicId===${JSON.stringify(topicId)}&&ref.version===1})()`)
    await navigate({ kind: 'delivery', ref: { characterId: reviewer.id, topicId: handoff.topicId, version: 1 } }); await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet[open] [data-return-review]'))")
    await click('.contact-work-sheet[open] [data-return-review]'); await waitForRenderer(window, "Boolean(document.querySelector('[data-delivery-feedback]'))")
    await fill('[data-delivery-feedback]', '采纳精简结尾的意见。'); await click('[data-delivery-submit]'); await waitForRenderer(window, "!document.querySelector('[data-contact-revision-dialog]')", 15000)
    await waitForRenderer(window, `(async()=>{const d=await window.electronAPI.agents.delivery(${JSON.stringify(owner)},${JSON.stringify(topicId)});return d?.version===2})()`, 40000).catch(e => { console.error('EXPERIENCE_REVISION', JSON.stringify({ runs: store.overview(owner).runs, requests: requests.slice(-6) })); throw e })
    await click('.contact-work-sheet[open] [data-return-review]'); await waitForRenderer(window, "Boolean(document.querySelector('[data-delivery-feedback]'))")
    await fill('[data-delivery-feedback]', '过期意见草稿'); await click('[data-delivery-submit]'); await waitForRenderer(window, "Boolean(document.querySelector('[data-contact-revision-dialog] [role=alert]'))")
    if (await run("document.querySelector('[data-delivery-feedback]').value") !== '过期意见草稿') throw Error('Conflict erased opinion')
    await waitForRenderer(window, "document.querySelector('[data-contact-revision-dialog] footer button[type=button]')?.disabled===false")
    await click('[data-contact-revision-dialog] footer button[type=button]')
    await flushDatabase()
    for (const version of [1, 2]) {
      const session = getSessions().filter(s => s.characterId === owner).map(s => getSession(s.id)!).find(s => s.messages.some(m => m.communication?.source.kind === 'task' && m.communication.source.topicId === topicId && m.communication.source.artifact?.version === version))
      const message = session?.messages.find(m => m.communication?.source.kind === 'task' && m.communication.source.topicId === topicId && m.communication.source.artifact?.version === version)
      if (!message || !session) throw Error('No persisted delivery receipt for version ' + version)
      await navigate({ kind: 'message', sessionId: session.id, messageId: message.id })
      const selector = `[data-message-id="${message.id}"] [data-delivery-receipt]`
      await waitForRenderer(window, `Boolean(document.querySelector(${JSON.stringify(selector)}))`); await click(selector)
      await waitForRenderer(window, `document.querySelector('.contact-work-sheet[open] [data-delivery-version]')?.dataset.deliveryVersion==='${version}'`)
    }
    await waitForRenderer(window, "document.querySelector('.contact-work-sheet[open] .contact-markdown')?.textContent.includes('转身回家')")
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet[open] .contact-context-references summary'))").catch(e => { console.error('BACKGROUND_REFERENCES', JSON.stringify(store.detail(owner, store.deliveries.get(topicId)!.runId))); throw e })
    await click('.contact-work-sheet[open] .contact-context-references summary')
    await waitForRenderer(window, "document.querySelector('.contact-work-sheet[open] .contact-context-references')?.textContent.includes('本任务主角叫沈青')")
    await run(`window.electronAPI.agents.updateMemory(${JSON.stringify(owner)},${JSON.stringify(memory.id)},1,${JSON.stringify({ content: '后来改名陆白', kind: 'project', scope: { kind: 'task', topicId }, source: { kind: 'user', at: Date.now() } })})`)
    if (!await run("document.querySelector('.contact-work-sheet[open] .contact-context-references').textContent.includes('第 1 版：本任务主角叫沈青')")) throw Error('Background references drifted to corrected memory')
    await run(`window.electronAPI.agents.forgetMemory(${JSON.stringify(owner)},${JSON.stringify(memory.id)},2)`)
    await waitForRenderer(window, "document.querySelector('.contact-work-sheet[open] .contact-context-references')?.textContent.includes('此记忆已移除')")
    if (Buffer.from(store.files.read(owner, fileId).bytes).toString() !== prose) throw Error('Revision changed archived original bytes')
    // The existing single-opinion dialog now records an actual revision cause/result.
    await click('.contact-work-sheet[open] [data-delivery-revise]')
    await waitForRenderer(window, "Boolean(document.querySelector('[data-contact-revision-dialog]'))")
    await fill('[data-delivery-feedback]', '保留原文来源，再核对结尾。')
    const runCount = store.overview(owner).runs.length
    store.db.exec("CREATE TRIGGER feedback_ui_failure BEFORE INSERT ON contact_delivery_feedback BEGIN SELECT RAISE(ABORT,'feedback UI storage fixture'); END")
    await click('[data-delivery-submit]')
    await waitForRenderer(window, "document.querySelector('[data-contact-revision-dialog] [role=alert]')?.textContent.includes('feedback UI storage fixture')")
    if (await run("document.querySelector('[data-delivery-feedback]').value") !== '保留原文来源，再核对结尾。' || store.overview(owner).runs.length !== runCount) throw Error('Feedback failure lost draft or queued unrecorded work')
    store.db.exec('DROP TRIGGER feedback_ui_failure')
    await waitForRenderer(window, "!document.querySelector('[data-delivery-submit]').disabled")
    await click('[data-delivery-submit]')
    await waitForRenderer(window, "!document.querySelector('[data-contact-revision-dialog]')")
    await waitForRenderer(window, `(async()=>{const rows=await window.electronAPI.agents.deliveryFeedbackList(${JSON.stringify(owner)},${JSON.stringify(topicId)});return rows.some(r=>r.baseVersion===2&&r.resultVersion===3&&r.status==='completed')})()`, 40000)
    const feedback = store.feedbackLedger.list(owner, topicId)[0]
    if (!feedback.runId || store.deliveries.get(topicId, 3)?.runId !== feedback.runId) throw Error('Feedback points to a different result run')
    const record = store.db.prepare('SELECT fingerprint FROM contact_delivery_feedback WHERE id=?').get(feedback.id) as { fingerprint: string }
    const [feedbackTopic, revision, version, action, reason, citation, scope] = JSON.parse(record.fingerprint)
    await run(`window.electronAPI.agents.deliveryFeedback(${JSON.stringify(owner)},${[feedbackTopic, revision, version, action, reason, feedback.requestId, citation, scope].map(v => JSON.stringify(v)).join(',')})`)
    if (store.overview(owner).runs.length !== runCount + 1 || store.feedbackLedger.list(owner, topicId).length !== 1) throw Error('Feedback response retry duplicated work')
    const feedbackRoot = '.contact-work-sheet[open] .contact-portfolio [data-delivery-feedback-records]'
    await waitForRenderer(window, `Boolean(document.querySelector('${feedbackRoot} [data-feedback-result]'))`)
    await click(`${feedbackRoot} [data-feedback-base]`)
    await waitForRenderer(window, "document.querySelector('.contact-work-sheet[open] [data-delivery-version]')?.dataset.deliveryVersion==='2'")
    await click(`${feedbackRoot} [data-feedback-result]`)
    await waitForRenderer(window, "document.querySelector('.contact-work-sheet[open] [data-delivery-version]')?.dataset.deliveryVersion==='3'")
    await navigate({ kind: 'task', characterId: owner, topicId })
    await waitForRenderer(window, "[...document.querySelectorAll('.contact-work-sheet[open] [role=tab]')].some(b=>b.textContent==='互动记录')")
    await run("[...document.querySelectorAll('.contact-work-sheet[open] [role=tab]')].find(b=>b.textContent==='互动记录').click()")
    const interactionRoot = '.contact-work-sheet[open] [data-topic-interactions] [data-delivery-feedback-records]'
    await waitForRenderer(window, `Boolean(document.querySelector('${interactionRoot} [data-feedback-result]'))`)
    await click(`${interactionRoot} [data-feedback-base]`)
    await waitForRenderer(window, "document.querySelector('.contact-work-sheet[open] [data-delivery-version]')?.dataset.deliveryVersion==='2'")
    const screenshots = join(process.cwd(), 'artifacts', 'system-evolution', 'feedback'); mkdirSync(screenshots, { recursive: true })
    for (const theme of ['light', 'dark']) for (const width of [375, 1024]) {
      await run(`document.documentElement.dataset.theme='${theme}'`)
      window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 768 }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1, viewSize: { width, height: 768 }, scale: 1 })
      await waitForRenderer(window, `window.innerWidth === ${width} && document.documentElement.dataset.theme === '${theme}'`)
      await run(`document.querySelector('${feedbackRoot}').scrollIntoView({block:'center'}); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
      // capturePage may still contain the previous compositor frame after DOM layout.
      await new Promise(resolve => setTimeout(resolve, 350))
      if (!await run(`(()=>{const e=document.querySelector('${feedbackRoot}');return e.scrollWidth<=e.clientWidth+1})()`)) throw Error('Feedback overflows the reader')
      writeFileSync(join(screenshots, `${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG())
    }
    window.webContents.disableDeviceEmulation(); await run("document.documentElement.dataset.theme='light'")
    recoveryUnavailable = true
    await run(`window.electronAPI.agents.deliveryFeedback(${JSON.stringify(owner)},${JSON.stringify(topicId)},${store.topics.get(owner, topicId).revision},3,'revise','RECOVERY_SMOKE：保留引用并修订结尾。','experience-recovery')`)
    await waitForRenderer(window, `(async()=>{const rows=await window.electronAPI.agents.deliveryFeedbackList(${JSON.stringify(owner)},${JSON.stringify(topicId)});return rows.some(r=>r.requestId==='experience-recovery'&&r.status==='failed'&&!r.resultVersion)})()`, 40000)
    if (await run("document.querySelector('.contact-work-sheet[open] [data-delivery-version]')?.dataset.deliveryVersion") !== '2') throw Error('Failure moved the fixed-version reader')
    const failedFeedback = store.feedbackLedger.list(owner, topicId).find(r => r.requestId === 'experience-recovery')!
    const retryRevision = store.topics.get(owner, topicId).revision, beforeRetry = store.overview(owner).runs.length
    recoveryUnavailable = false
    const retryCall = `window.electronAPI.agents.continueTopic(${JSON.stringify(owner)},${JSON.stringify(topicId)},${retryRevision},'重试原修改意见','experience-retry')`
    await run(retryCall); await run(retryCall)
    await waitForRenderer(window, `(async()=>{const rows=await window.electronAPI.agents.deliveryFeedbackList(${JSON.stringify(owner)},${JSON.stringify(topicId)});return rows.some(r=>r.requestId==='experience-recovery'&&r.resultVersion===4)})()`, 40000)
    const recovered = store.feedbackLedger.list(owner, topicId).find(r => r.requestId === 'experience-recovery')!
    if (store.overview(owner).runs.length !== beforeRetry + 1 || recovered.originalRunId !== failedFeedback.runId || store.deliveries.get(topicId, 4)?.runId !== recovered.runId) throw Error('Recovery lost provenance or duplicated a round')
    if (JSON.parse(store.getRun(recovered.runId!)!.input).revisionCitation.ref.version !== 3 || await run("document.querySelector('.contact-work-sheet[open] [data-delivery-version]')?.dataset.deliveryVersion") !== '2') throw Error('Recovery drifted the source or current reader')
    await run(`document.querySelector('${feedbackRoot}').scrollIntoView({block:'center'})`)
    await new Promise(resolve => setTimeout(resolve, 350))
    writeFileSync(join(screenshots, 'recovered.png'), (await window.webContents.capturePage()).toPNG())
    console.log('CHOUYU_RECOVERY_FLOW_SMOKE_PASSED actual network failure, same task/opinion/source v3, stable retry once, result v4, reader retained at v2')
    console.log('CHOUYU_FEEDBACK_LEDGER_SMOKE_PASSED single dialog failure/retry, actual revision, stable replay, fixed base/result, interactions and responsive themes')
    mkdirSync('artifacts/contact-experience', { recursive: true }); writeFileSync('artifacts/contact-experience/receipt.png', (await window.webContents.capturePage()).toPNG())
    writeFileSync('artifacts/contact-experience/result.json', JSON.stringify({ owner, topicId, material, memoryId: memory.id, fileId, handoff, sourceVersion: 1, revisedVersion: 2, requests: requests.length }, null, 2))
    console.log('CHOUYU_CONTACT_EXPERIENCE_SMOKE_PASSED one source: scoped material/memory, actual task tools/prose/file, restart, exact citation discussion, independent review, returned opinion, stale conflict and revised source')
  } finally { store.close(); saveConfig(originalConfig); selectChatSession(originalSession); await flushDatabase(); await new Promise<void>(resolve => server.close(() => resolve())) }
}
