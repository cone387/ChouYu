import { app, type BrowserWindow } from 'electron'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { AgentStore } from '../agents/store'
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
  const store = new AgentStore(join(app.getPath('userData'), 'contact-agents', 'agents.db')), originalConfig = getConfig(), originalSession = getActiveSession().id
  let material: { id: string; version: number }, topicId = '', initial = true
  const requests: { model: string; messages: unknown[] }[] = []
  const prose = '沈青站在雾港，望着周四亮起的蓝色灯光。潮汐带来一封信，她读了很久，才慢慢转身。'
  const server = createServer((request, response) => {
    let body = ''; request.on('data', chunk => { body += chunk }); request.on('end', () => {
      try {
        const payload = JSON.parse(body), prompt = JSON.stringify(payload.messages); requests.push({ model: payload.model, messages: payload.messages })
        let delta: unknown
        const call = (name: string, args: unknown) => ({ tool_calls: [{ index: 0, id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
        if (payload.messages.some((message: { role: string; content?: unknown }) => message.role === 'user' && typeof message.content === 'string' && message.content.startsWith('EXPERIENCE_DISCUSSION'))) delta = { content: '蓝色灯光与来信形成了悬念，节奏可以在结尾收紧。' }
        else if (payload.model !== 'review-model' && initial && prompt.includes('正在执行用户交付的写作任务')) {
          const toolMessages = payload.messages.filter((m: { role: string }) => m.role === 'tool')
          if (!toolMessages.length) delta = call('read_contact_material', { ...material, topicId })
          else if (toolMessages.length === 1) delta = call('write_skill_file', { skillId: 'experience-output', path: 'story.md', content: prose })
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
    await run(`window.electronAPI.agents.run(${JSON.stringify(owner)},${JSON.stringify(topicId)})`)
    await waitForRenderer(window, `(async()=>{const d=await window.electronAPI.agents.delivery(${JSON.stringify(owner)},${JSON.stringify(topicId)});return d?.version===1})()`, 40000).catch(e => { console.error('EXPERIENCE_RUN', store.overview(owner).runs, requests.map(r => ({ model: r.model, tail: JSON.stringify(r.messages).slice(-900) }))); throw e })
    const first = store.deliveries.get(topicId)!, fileId = first.fileIds?.[0]
    if (!fileId || !first.sections[0].body.includes('沈青')) throw Error('Actual task did not save prose and file')
    if (Buffer.from(store.files.read(owner, fileId).bytes).toString() !== prose) throw Error('Archived bytes mismatch')
    const snapshot = JSON.parse(store.getRun(first.runId)!.input)
    if (!JSON.stringify(snapshot).includes(memory.id) || !JSON.stringify(snapshot).includes(material.id)) throw Error('Task lacks scoped source snapshots')
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
    await click('.contact-work-sheet[open] [data-return-review]'); await waitForRenderer(window, "Boolean(document.querySelector('[data-delivery-feedback]'))")
    await fill('[data-delivery-feedback]', '采纳精简结尾的意见。'); await click('[data-delivery-submit]'); await waitForRenderer(window, "!document.querySelector('[data-contact-revision-dialog]')", 15000)
    await waitForRenderer(window, `(async()=>{const d=await window.electronAPI.agents.delivery(${JSON.stringify(owner)},${JSON.stringify(topicId)});return d?.version===2})()`, 40000).catch(e => { console.error('EXPERIENCE_REVISION', JSON.stringify({ runs: store.overview(owner).runs, requests: requests.slice(-6) })); throw e })
    await click('.contact-work-sheet[open] [data-return-review]'); await waitForRenderer(window, "Boolean(document.querySelector('[data-delivery-feedback]'))")
    await fill('[data-delivery-feedback]', '过期意见草稿'); await click('[data-delivery-submit]'); await waitForRenderer(window, "Boolean(document.querySelector('[data-contact-revision-dialog] [role=alert]'))")
    if (await run("document.querySelector('[data-delivery-feedback]').value") !== '过期意见草稿') throw Error('Conflict erased opinion')
    await waitForRenderer(window, "document.querySelector('[data-contact-revision-dialog] footer button[type=button]')?.disabled===false")
    await click('[data-contact-revision-dialog] footer button[type=button]')
    await navigate({ kind: 'delivery', ref: { characterId: owner, topicId, version: 2 } }); await waitForRenderer(window, "document.querySelector('.contact-work-sheet[open] .contact-markdown')?.textContent.includes('转身回家')")
    if (Buffer.from(store.files.read(owner, fileId).bytes).toString() !== prose) throw Error('Revision changed archived original bytes')
    mkdirSync('artifacts/contact-experience', { recursive: true }); writeFileSync('artifacts/contact-experience/receipt.png', (await window.webContents.capturePage()).toPNG())
    writeFileSync('artifacts/contact-experience/result.json', JSON.stringify({ owner, topicId, material, memoryId: memory.id, fileId, handoff, sourceVersion: 1, revisedVersion: 2, requests: requests.length }, null, 2))
    console.log('CHOUYU_CONTACT_EXPERIENCE_SMOKE_PASSED one source: scoped material/memory, actual task tools/prose/file, restart, exact citation discussion, independent review, returned opinion, stale conflict and revised source')
  } finally { store.close(); saveConfig(originalConfig); selectChatSession(originalSession); await flushDatabase(); await new Promise<void>(resolve => server.close(() => resolve())) }
}
