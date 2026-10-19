import { app, type BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCharacter, listCharacters, createChatSession, getActiveSession, saveMessages, selectChatSession } from '../database'
import { ContactTaskStore } from '../task-center/contact-store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { beginContactQueryMeasurement, endContactQueryMeasurement, failContactReadForSmoke } from '../agents/query-metrics'
import { waitForRenderer } from './storage-smoke'

/** Fixed isolated data and navigation; no external model calls. */
export async function runContactPerformanceSmoke(window: BrowserWindow) {
  const run = (code: string) => window.webContents.executeJavaScript(code)
  while (listCharacters().length < 24) createCharacter({ name: `Performance ${listCharacters().length}`, soulMd: 'Independent fixture contact.' })
  const owners = listCharacters().map(c => c.id)
  const originalSession = getActiveSession().id
  for (const owner of owners) {
    createChatSession('Performance conversation', owner)
    saveMessages(Array.from({ length: 50 }, (_, n) => ({ id: `performance-${owner}-${n}`, role: n % 2 ? 'assistant' as const : 'user' as const, content: 'A saved conversation paragraph. '.repeat(65), timestamp: Date.now() + n })))
  }
  selectChatSession(originalSession)
  await run(`window.electronAPI.agents.get(${JSON.stringify(owners[0])})`)
  const store = new ContactTaskStore(join(app.getPath('userData'), 'contact-agents', 'agents.db'))
  const targets: { characterId: string; topicId: string }[] = []
  for (const owner of owners) {
    store.save(owner, { ...DEFAULT_AGENT_SETTINGS, goal: 'Fixture work', enabled: false, dailyCalls: 200 })
    const topics = [store.overview(owner).topics[0], ...Array.from({ length: 19 }, (_, n) => store.topics.create(owner, { title: `Task ${n + 2}`, goal: 'Fixture task', constraints: '' }, 'Fixture'))]
    const topicId = topics[0].id
    for (let section = 0; section < 8; section++) {
    const runId = store.createRun(owner, '', Date.now(), topicId)
    const body = 'Long manuscript paragraph with stable original content.\n\n'.repeat(175)
    store.finish(runId, { runId, title: 'Saved manuscript', body, nextStep: 'Continue', evidence: [], createdAt: Date.now() }, [],
      { status: 'researching', judgement: 'Saved', openQuestions: '', nextStep: 'Continue', reason: 'Saved' },
      { completionCriteria: 'Manuscript', stages: [{ id: 'draft', title: 'Draft', status: 'active' }], summary: 'Saved', section: { id: `body-${section}`, title: `Manuscript ${section + 1}`, body } })
    }
    targets.push({ characterId: owner, topicId })
  }
  const waitingOwner = targets[4].characterId
  const question = store.topics.create(waitingOwner, { title: 'Hidden home question', goal: 'Ask', constraints: '' })
  store.wait(store.createRun(waitingOwner, '', Date.now(), question.id), 'Keep this pending question and its draft.')
  store.close()
  window.webContents.send('open-chat-panel')
  await waitForRenderer(window, "Boolean(document.querySelector('.chat-panel[data-ready=true]'))")
  const phases: unknown[] = []
  const measure = async (name: string, action: () => Promise<unknown>) => {
    beginContactQueryMeasurement(); const start = performance.now()
    await action()
    const samples = endContactQueryMeasurement(), sorted = samples.map(s => s.milliseconds).sort((a, b) => a - b)
    if (name === 'three-hidden-one-visible-12s' && process.env.CHOUYU_CONTACT_QUERY_REGRESSION === '1') {
      const hidden = new Set(targets.slice(0, 3).map(t => t.characterId))
      if (samples.some(sample => sample.owner && hidden.has(sample.owner))) throw Error('Hidden retained contact issued an IPC read')
    }
    phases.push({ name, elapsedMs: performance.now() - start, requests: samples.length, byChannel: samples.reduce<Record<string, number>>((all, s) => { all[s.channel] = (all[s.channel] ?? 0) + 1; return all }, {}), p50Ms: sorted[Math.floor(sorted.length * .5)] ?? 0, p95Ms: sorted[Math.floor(sorted.length * .95)] ?? 0, processMemory: app.getAppMetrics().map(m => ({ type: m.type, ...m.memory })) })
  }
  const navigate = (target: unknown) => run(`new Promise((resolve,reject)=>{const detail={target:${JSON.stringify(target)},handled:false,resolve,reject};window.dispatchEvent(new CustomEvent('chouyu:contact-navigation',{detail}));if(!detail.handled)reject(Error('No navigation handler'))})`)
  await measure('open-four-contact-readers', async () => {
    for (const [index, target] of targets.slice(0, 4).entries()) {
      if (!index) await navigate({ kind: 'delivery', ref: { ...target, version: 8 } })
      else {
        await run(`Array.from(document.querySelectorAll('[data-delivery-discuss]')).find(e=>e.getClientRects().length).focus()`)
        await navigate({ kind: 'contact-settings', characterId: target.characterId, tab: 'settings' })
        await waitForRenderer(window, `Boolean(document.querySelector('[data-contact-agent="${target.characterId}"]'))`)
        await run(`document.querySelector('[data-contact-agent="${target.characterId}"]').closest('dialog').querySelector('[data-contact-dialog-tab="portfolio"]').click()`)
        await waitForRenderer(window, `Boolean(document.querySelector('[data-contact-agent="${target.characterId}"] .portfolio-open'))`)
        await run(`document.querySelector('[data-contact-agent="${target.characterId}"] .portfolio-open').click()`)
      }
      await waitForRenderer(window, `Array.from(document.querySelectorAll('[data-contact-agent="${target.characterId}"] [data-delivery-version="8"]')).some(e=>e.getClientRects().length)`)
    }
    if (await run(`document.querySelectorAll('[data-contact-portfolio]').length`) < 4) throw Error('Performance path did not retain hidden readers')
  })
  await measure('three-hidden-one-visible-12s', () => new Promise(resolve => setTimeout(resolve, 12000)))
  await measure('return-previous-reader', async () => {
    await run(`Array.from(document.querySelectorAll('[data-contact-return]')).find(e=>e.getClientRects().length).click()`)
    await waitForRenderer(window, `Array.from(document.querySelectorAll('[data-contact-agent="${targets[2].characterId}"] [data-delivery-version="8"]')).some(e=>e.getClientRects().length)`)
  })
  const label = process.env.CHOUYU_CONTACT_PERFORMANCE_LABEL || 'measurement'
  mkdirSync('artifacts/contact-next', { recursive: true })
  writeFileSync(`artifacts/contact-next/performance-${label}.json`, JSON.stringify({ contacts: owners.length, tasks: owners.length * 20, manuscriptCharacters: 78400, chatMessagesPerContact: 50, chatCharactersPerMessage: 2015, phases }, null, 2))
  console.log('CHOUYU_CONTACT_PERFORMANCE_PASSED', JSON.stringify(phases))
  if (process.env.CHOUYU_CONTACT_QUERY_REGRESSION === '1') {
    const target = targets[4], panel = `[data-contact-agent="${target.characterId}"]`
    await navigate({ kind: 'contact-settings', characterId: target.characterId, tab: 'settings' })
    await waitForRenderer(window, `Boolean(document.querySelector('${panel}'))`)
    const tab = async (name: string) => {
      await run(`document.querySelector('${panel}').closest('dialog').querySelector('[data-contact-dialog-tab="${name}"]').click()`)
      await waitForRenderer(window, `document.querySelector('${panel}')?.dataset.selectedTab === '${name}'`)
    }
    await tab('overview')
    await waitForRenderer(window, `Boolean(document.querySelector('${panel} [data-home-pending] textarea'))`)
    await run(`(()=>{const e=document.querySelector('${panel} [data-home-pending] textarea');e.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Unsaved answer');e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await navigate({ kind: 'contact-settings', characterId: targets[5].characterId, tab: 'settings' })
    await waitForRenderer(window, `Boolean(document.querySelector('[data-contact-agent="${targets[5].characterId}"]'))`)
    await new Promise(resolve => setTimeout(resolve, 500))
    beginContactQueryMeasurement()
    window.webContents.send('agents:changed', target.characterId)
    await new Promise(resolve => setTimeout(resolve, 750))
    const hiddenHomeReads = endContactQueryMeasurement()
    if (hiddenHomeReads.some(sample => sample.channel === 'agents:getInteraction' && sample.owner === target.characterId)) throw Error('Hidden contact home still refreshed its pending interaction')
    await run(`Array.from(document.querySelectorAll('[data-contact-return]')).find(e=>e.getClientRects().length).click()`)
    await waitForRenderer(window, `document.querySelector('${panel} [data-home-pending] textarea')?.getClientRects().length > 0`)
    await waitForRenderer(window, `document.querySelector('${panel} [data-home-pending] textarea')?.value === 'Unsaved answer'`)
    await tab('portfolio')
    await waitForRenderer(window, `Boolean(document.querySelector('${panel} .portfolio-open'))`)
    failContactReadForSmoke(target.characterId)
    try {
      await run(`document.querySelector('${panel} .portfolio-open').click()`)
      await waitForRenderer(window, `document.querySelector('${panel} .contact-portfolio .contact-delivery')?.textContent.includes('CONTACT_READ_RESTART_FIXTURE')`)
      await tab('settings')
    } finally { failContactReadForSmoke() }
    await tab('portfolio')
    await waitForRenderer(window, `Boolean(document.querySelector('${panel} .contact-portfolio [data-delivery-version="8"]'))`)
    await run(`document.querySelector('${panel} .contact-portfolio .delivery-reader').scrollTop = 400`)
    const before = await run(`document.querySelector('${panel} .contact-portfolio .delivery-reader').scrollTop`)
    await tab('settings')
    await waitForRenderer(window, `Boolean(document.querySelector('${panel} [data-agent-sources]'))`)
    await run(`(()=>{const e=document.querySelector('${panel} [data-agent-sources]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'https://example.com/unsaved-draft');e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    const changedStore = new ContactTaskStore(join(app.getPath('userData'), 'contact-agents', 'agents.db'))
    const nextRun = changedStore.createRun(target.characterId, '', Date.now(), target.topicId)
    changedStore.finish(nextRun, { runId: nextRun, title: 'New version', body: 'Updated saved paragraph.', nextStep: 'Continue', evidence: [], createdAt: Date.now() }, [],
      { status: 'researching', judgement: 'Saved', openQuestions: '', nextStep: 'Continue', reason: 'Saved' },
      { completionCriteria: 'Manuscript', stages: [{ id: 'draft', title: 'Draft', status: 'active' }], summary: 'New version', section: { id: 'body-7', title: 'Manuscript 8', body: 'Updated saved paragraph.' } })
    changedStore.close()
    window.webContents.send('agents:changed', target.characterId)
    await tab('portfolio')
    await waitForRenderer(window, `document.querySelector('${panel} .contact-portfolio .delivery-reader')?.getClientRects().length > 0`)
    await waitForRenderer(window, `document.querySelector('${panel} .contact-portfolio [data-delivery-latest]')?.textContent.includes('9')`)
    if (!await run(`Boolean(document.querySelector('${panel} .contact-portfolio [data-delivery-version="8"]'))`)) throw Error('Returning reader silently upgraded its version')
    const after = await run(`document.querySelector('${panel} .contact-portfolio .delivery-reader').scrollTop`)
    if (Math.abs(before - after) > 1 || before < 10) throw Error(`Reading position lost on return: ${before} -> ${after}`)
    await tab('settings')
    if (await run(`document.querySelector('${panel} [data-agent-sources]').value`) !== 'https://example.com/unsaved-draft') throw Error('Unsaved work setting lost across visibility refresh')
    console.log('CHOUYU_CONTACT_QUERY_RECOVERY_PASSED failed read, hidden return retry, fixed version, scroll and draft retained; hidden contacts issued zero reads')
  }
}
