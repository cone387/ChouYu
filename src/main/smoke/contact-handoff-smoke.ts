import { app, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { AgentStore } from '../agents/store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { createCharacter, getActiveSession, selectChatSession, flushDatabase } from '../database'
import { restartAgentsForSmoke } from '../agents'
import { waitForRenderer } from './storage-smoke'

export function handoffSmokeResponse(payload: { model?: string; messages?: unknown[] }): string {
  const prompt = JSON.stringify(payload.messages)
  if (prompt.includes('你只负责路由')) return JSON.stringify({ kind: 'none' })
  if (prompt.includes('任务结束核对。')) return JSON.stringify({ mode: 'finite', satisfied: true, endsAt: null, reason: '已读取指定原文并保存评审意见。', nextStep: '', completionCriteria: '评审指定原文并提出修改意见' })
  if (prompt.includes('统一解析用户对联系人任务')) return JSON.stringify({ kind: 'work', description: '评审指定原文这一版，给结论、依据与具体修改建议。', continuousReview: false })
  if (prompt.includes('刚收到用户交付的任务')) return JSON.stringify({ title: '稿件评审', nextStep: '读取原文并交付评审', question: '', plan: { completionCriteria: '评审指定原文并提出修改意见', stages: [{ id: 'review', title: '评审原文', status: 'pending' }] } })
  if (prompt.includes('为联系人的同一个事项安排本轮工作')) return JSON.stringify({ action: 'write', reason: '按认可的评审意见修订原文', sectionId: 'text', evaluation: false, urls: [], query: '', checkAfterMinutes: 15 })
  const reviewer = payload.model === 'review-model'
  return JSON.stringify({ title: reviewer ? '评审意见' : '修订正文', body: reviewer ? '开头清楚，结尾可以更简洁。依据原文 [1]。' : '按用户意见调整了结尾。', nextStep: reviewer ? '' : '继续写作', memories: [], question: '',
    progress: { status: reviewer ? 'completed' : 'researching', judgement: '已交付正文', reason: '依据原文与用户要求交付', nextStep: reviewer ? '' : '继续写作', openQuestions: '' },
    delivery: { completionCriteria: reviewer ? '评审指定原文并提出修改意见' : 'Finish draft', stages: [{ id: reviewer ? 'review' : 'write', title: reviewer ? '评审原文' : '创作', status: reviewer ? 'done' : 'active' }], summary: '已保存', section: { id: reviewer ? 'opinion' : 'text', title: reviewer ? '评审' : '正文', body: reviewer ? '建议保留开头，缩短结尾。' : '原句：潮汐带来一封信。她读完，转身回家。' } },
    ...(reviewer ? { evaluations: [{ subject: '原文', sourceNumbers: [1], dimensions: [{ name: '叙事清晰度', score: 4, maxScore: 5, weight: 100, reason: '开头清楚，结尾冗长。' }], summary: '建议保留开头，缩短结尾。', risks: '删减过多可能削弱氛围。', nextStep: '请作者按用户选定意见修订。' }] } : {}) })
}
export async function runContactHandoffSmoke(window: BrowserWindow, owner: string, reviewRequests: () => string[]) {
  const run = (code: string) => window.webContents.executeJavaScript(code)
  const click = async (selector: string) => {
    const point = await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Missing handoff control '+${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);if(!e.contains(document.elementFromPoint(x,y)))throw Error('Handoff control covered');return {x,y}})()`)
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point }); window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
  }
  const fill = (selector: string, value: string, select = false) => run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${select ? 'HTMLSelectElement' : 'HTMLTextAreaElement'}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('${select ? 'change' : 'input'}',{bubbles:true}))})()`)
  const navigate = (target: unknown) => run(`new Promise((resolve,reject)=>{const detail={target:${JSON.stringify(target)},handled:false,resolve,reject};window.dispatchEvent(new CustomEvent('chouyu:contact-navigation',{detail}));if(!detail.handled)reject(Error('No navigation handler'))})`)
  const store = new AgentStore(join(app.getPath('userData'), 'contact-agents', 'agents.db')), active = getActiveSession().id
  try {
    const reviewer = createCharacter({ name: '交接评审者', model: 'review-model', soulMd: '依据实际稿件提出独立意见。' })
    for (const id of [owner, reviewer.id]) {
      await run(`window.electronAPI.agents.get(${JSON.stringify(id)})`)
      await run(`window.electronAPI.agents.save(${JSON.stringify(id)},${JSON.stringify({ ...DEFAULT_AGENT_SETTINGS, goal: 'Writing work', enabled: false, dailyCalls: 100, shareDeliveries: true, readContactDeliveries: true })})`)
    }
    store.remember(owner, 'PRIVATE_HANDOFF_SMOKE')
    const topic = store.topics.create(owner, { title: '交接稿件', goal: 'Write a story', constraints: '' }, 'smoke'), runId = store.createRun(owner, '', Date.now(), topic.id)
    store.finish(runId, { runId, title: '稿件', body: '原文', nextStep: 'Continue', evidence: [], createdAt: Date.now() }, [], { status: 'researching', judgement: 'Saved', reason: 'Saved', nextStep: 'Continue', openQuestions: '' }, { completionCriteria: 'Finish draft', stages: [{ id: 'write', title: '创作', status: 'active' }], summary: 'Saved', section: { id: 'text', title: '正文', body: '原句：潮汐带来一封信。她花了很久很久读完，又花了很久很久回家。' } })
    await navigate({ kind: 'delivery', ref: { characterId: owner, topicId: topic.id, version: 1 } })
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet [data-delivery-handoff]'))")
    await click('.contact-work-sheet [data-delivery-handoff]')
    await waitForRenderer(window, `Boolean(document.querySelector('[data-handoff-recipient] option[value="${reviewer.id}"]'))`)
    await fill('[data-handoff-recipient]', reviewer.id, true); await fill('[data-contact-handoff-dialog] [data-task-description]', '请评审这一版稿件，指出可以精简的句子。')
    const screenshots = join(process.cwd(), 'artifacts', 'contact-handoffs'); mkdirSync(screenshots, { recursive: true })
    for (const theme of ['light', 'dark']) for (const width of [375, 1024]) {
      await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
      window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 768 }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1, viewSize: { width, height: 768 }, scale: 1 })
      await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      writeFileSync(join(screenshots, `${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG())
    }
    window.webContents.disableDeviceEmulation(); await run("document.documentElement.dataset.theme='light'")
    await click('[data-handoff-save]')
    await waitForRenderer(window, "!document.querySelector('[data-contact-handoff-dialog]')", 20000)
    const handoff = store.handoffs.list(owner, topic.id)[0]
    if (!handoff) throw new Error('Handoff not persisted')
    await waitForRenderer(window, `(async()=>{const state=await window.electronAPI.agents.handoffState(${JSON.stringify(owner)},${JSON.stringify(handoff.id)});return state.reviewedVersion===1})()`, 40000).catch(error => { console.error('HANDOFF_DIAGNOSTIC', JSON.stringify({ state: store.handoffs.state(owner, handoff.id), runs: store.overview(reviewer.id).runs, requestCount: reviewRequests().length })); throw error })
    if (!reviewRequests().some(prompt => prompt.includes('潮汐带来一封信')) || reviewRequests().some(prompt => prompt.includes('PRIVATE_HANDOFF_SMOKE'))) throw new Error('Reviewer did not receive exact source or received private memory')
    await restartAgentsForSmoke()
    await navigate({ kind: 'delivery', ref: { characterId: reviewer.id, topicId: handoff.topicId, version: 1 } })
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet [data-return-review]'))")
    await click('.contact-work-sheet [data-return-review]'); await waitForRenderer(window, "Boolean(document.querySelector('[data-contact-revision-dialog][open]'))")
    await fill('[data-delivery-feedback]', '保留开头，按意见缩短结尾。'); await click('[data-delivery-submit]')
    await waitForRenderer(window, "!document.querySelector('[data-contact-revision-dialog]')", 15000)
    await waitForRenderer(window, `(async()=>{const a=await window.electronAPI.agents.delivery(${JSON.stringify(owner)},${JSON.stringify(topic.id)});return a.version===2})()`, 40000)
    if (!store.deliveries.get(topic.id)?.sections[0].body.includes('转身回家')) throw new Error('Returned review did not produce actual author revision')
    await click('.contact-work-sheet [data-return-review]'); await waitForRenderer(window, "Boolean(document.querySelector('[data-delivery-feedback]'))")
    await fill('[data-delivery-feedback]', '过期评审的草稿必须保留'); await click('[data-delivery-submit]')
    await waitForRenderer(window, "Boolean(document.querySelector('[data-contact-revision-dialog] [role=alert]'))")
    if (await run("document.querySelector('[data-delivery-feedback]').value") !== '过期评审的草稿必须保留') throw new Error('Stale review erased draft')
    await click('[data-contact-revision-dialog] footer button[type=button]')
    console.log('CHOUYU_CONTACT_HANDOFF_SMOKE_PASSED two contacts, actual parser/review/source isolation, restart, returned opinion, author revision and stale draft')
  } finally { store.close(); selectChatSession(active); await flushDatabase() }
}
