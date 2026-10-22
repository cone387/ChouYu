import { app, type BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCharacter, createChatSession, getContactProfile, getConfig, listCharacters, getSession, getState, contactSearchCredential, appendAgentNotice, appendContactAction, selectChatSession, saveConfig } from '../database'
import { ContactTaskStore } from '../task-center/contact-store'
import { contactSkillLibrary } from '../skills'
import { DEFAULT_CHARACTER_ID } from '../../shared/characters'
import { contactAgentsCall, restartAgentsForSmoke } from '../agents'
import { waitForRenderer } from './storage-smoke'
import type { ContactActionInteraction } from '../../shared/contact-actions'
import { prepareRegisteredToolAsync } from '../tools/registry'
import type { AgentOverview } from '../../shared/agents'

/** Real registered tools/approval/IPC/storage with a local model fixture. */
export async function runContactConversationSmoke(window: BrowserWindow) {
  if (process.env.CHOUYU_SMOKE_TEST !== '1') throw new Error('Isolated smoke only')
  await window.webContents.executeJavaScript(`window.electronAPI.db.setState('workspace-active-page', 'chat')`)
  window.webContents.send('open-chat-panel')
  await waitForRenderer(window, `Boolean(document.querySelector('.chat-panel[data-ready=true]'))`, 15000)
  const template = listCharacters().find(c => !c.builtIn)!
  const character = createCharacter({ ...template, name: '对话工作验收', model: 'agent-smoke', soulMd: '验收独立人设' })
  const session = createChatSession('对话工作验收', character.id).activeSession.id
  const source = join(app.getPath('userData'), 'conversation-skill-fixture')
  mkdirSync(source, { recursive: true })
  writeFileSync(join(source, 'SKILL.md'), '---\nname: conversation-review\ndescription: Test review method\n---\nUse evidence before conclusions.')
  contactSkillLibrary().publish('conversation-review', source)
  const invoke = (content: string, owner = character.id, sessionId = session, approved: boolean | 'chat' = true) => {
    const request = { requestId: `conversation-${crypto.randomUUID()}`, sessionId, characterId: owner, systemPrompt: '联系人验收', messages: [{ role: 'user', content }] }
    return window.webContents.executeJavaScript(`(async()=>{
      const response=await window.electronAPI.ai.startStream(${JSON.stringify(request)});
      const approvals=(await window.electronAPI.agents.pendingInteractions(${JSON.stringify(owner)})).filter(c=>c.kind==='action'&&c.characterId===${JSON.stringify(owner)}&&c.request.sessionId===${JSON.stringify(sessionId)});
      if(approvals.length!==1) throw new Error('Expected exactly one durable card: '+JSON.stringify({response,approvals}));
      const card=approvals[0]; let saved;
      if (${JSON.stringify(approved)} === 'chat') {
        const reply=await window.electronAPI.ai.startStream(${JSON.stringify({ ...request, requestId: request.requestId + '-answer', messages: [{ role: 'user', content: '验收卡片同意' }] })});
        if(!reply.ok || !reply.reply?.includes('已保存')) throw new Error('Natural card response failed: '+JSON.stringify(reply));
        saved=await window.electronAPI.agents.getInteraction(card.characterId,card.id);
      } else saved=await window.electronAPI.agents.submitInteraction(card.characterId,card.id,{version:card.version,...(${approved === true}?{actionId:'apply'}:{reject:true})});
      const repeated=await window.electronAPI.agents.submitInteraction(card.characterId,card.id,{version:card.version,actionId:'apply'});
      if(JSON.stringify(saved)!==JSON.stringify(repeated))throw new Error('Duplicate submission changed receipt');
      return {response:{...response,reply:saved.result},approvals}
    })()`)
  }
  const before = getContactProfile(character.id)
  const profile = await invoke('验收对话资料：改名为对话新名字，模型改为agent-smoke-next，人设改为独立评审者', character.id, session, 'chat')
  if (!profile.response.ok || !profile.response.reply?.includes('已保存')) throw new Error(`Profile chat receipt failed: ${JSON.stringify(profile)}`)
  const saved = getContactProfile(character.id)
  if (saved.profile.name !== '对话新名字' || saved.profile.model !== 'agent-smoke-next' || saved.profile.soulMd !== '独立评审者' || saved.profile.avatar !== before.profile.avatar) throw new Error('Profile patch was not applied exactly')
  const stale = await window.webContents.executeJavaScript(`window.electronAPI.characters.update(${JSON.stringify(character.id)},${JSON.stringify({ ...before.profile, revision: before.revision })}).then(()=>false,e=>String(e).includes('变化'))`)
  if (!stale) throw new Error('Old manual profile overwrote chat settings')
  const permissions = await invoke('验收对话权限：仅指定网页，关闭通知，共享成果')
  if (!permissions.response.ok || !permissions.response.reply?.includes('已保存')) throw new Error(`Permission chat receipt failed: ${JSON.stringify(permissions)}`)
  await invoke('验收阅读偏好：以后评审排版紧凑些')
  const preferences = await contactAgentsCall(character.id, 'outputPreferences')
  if (preferences[0].preference.kind !== 'review' || preferences[0].preference.density !== 'compact') throw new Error('Output preference was not actually saved')
  const work = await window.webContents.executeJavaScript(`window.electronAPI.agents.get(${JSON.stringify(character.id)})`)
  if (work.topics.length || work.settings.permissionLevel !== 'sources' || work.settings.sources[0] !== 'https://example.com/' || work.settings.notifyProgress !== false || work.settings.shareDeliveries !== true) throw new Error('No-task permissions were not saved accurately')
  const denied = await invoke('验收对话技能：启用评审说明', character.id, session, false)
  if (!denied.approvals.length || contactSkillLibrary().snapshot(character.id).entries.length) throw new Error('Rejected skill confirmation changed permissions')
  const skill = await invoke('验收对话技能：启用评审说明')
  if (!skill.response.ok || !skill.response.reply?.includes('已启用')) throw new Error(`Skill chat receipt failed: ${JSON.stringify(skill)}`)
  if (contactSkillLibrary().snapshot(character.id).entries[0]?.id !== 'conversation-review' || contactSkillLibrary().snapshot(character.id).entries[0]?.scriptsEnabled) throw new Error('Skill enable did not preserve independent script authorization')
  const credentialRequest = { requestId: `credential-${crypto.randomUUID()}`, sessionId: session, characterId: character.id, systemPrompt: '联系人验收', messages: [{ role: 'user', content: '验收搜索安全输入：更新我的搜索密钥' }] }
  const manualCredential = await window.webContents.executeJavaScript(`window.electronAPI.agents.searchCredential(${JSON.stringify(character.id)})`)
  const secure = await window.webContents.executeJavaScript(`(async()=>{
    const reply=await window.electronAPI.ai.startStream(${JSON.stringify(credentialRequest)});
    if(!reply.ok)throw new Error('Credential card routing failed');
    const card=(await window.electronAPI.agents.pendingInteractions(${JSON.stringify(character.id)})).find(c=>c.kind==='action'&&c.request.input?.argument==='credential');
    if(!card)throw new Error('Missing secure credential card');
    return window.electronAPI.agents.submitInteraction(card.characterId,card.id,{version:card.version,actionId:'apply',credential:'fixture-private-search-value'});
  })()`)
  if (secure.status !== 'resolved' || !contactSearchCredential(character.id).configured || getState(`agent-search:${character.id}:api_key`) !== 'fixture-private-search-value') throw new Error('Secure input did not persist the actual credential')
  const staleCredential = await window.webContents.executeJavaScript(`window.electronAPI.agents.searchCredential(${JSON.stringify(character.id)},'stale-fixture',${manualCredential.revision}).then(()=>false,e=>String(e).includes('变化'))`)
  if (!staleCredential || getState(`agent-search:${character.id}:api_key`) !== 'fixture-private-search-value') throw new Error('Stale manual credential overwrote a chat update')
  const storage = new ContactTaskStore(join(app.getPath('userData'), 'contact-agents', 'agents.db'))
  try {
    const row = storage.db.prepare('SELECT value FROM contact_interactions WHERE id=?').get(secure.id) as { value: string }
    if (row.value.includes('fixture-private-search-value') || JSON.stringify(getSession(session)).includes('fixture-private-search-value')) throw new Error('Credential leaked into card or conversation storage')
  } finally { storage.close() }
  const assistantSession = createChatSession('内置资料验收', DEFAULT_CHARACTER_ID).activeSession.id
  const assistant = await invoke('验收对话内置：模型改为agent-smoke-built-in', DEFAULT_CHARACTER_ID, assistantSession)
  if (!assistant.response.ok || !assistant.response.reply?.includes('已保存') || getConfig().model !== 'agent-smoke-built-in') throw new Error(`Built-in effective model was not saved: ${JSON.stringify(assistant)}`)
  if (getContactProfile(character.id).profile.model !== 'agent-smoke-next') throw new Error('Built-in change overwrote another contact override')
  const combinationRequest = { requestId: `combination-${crypto.randomUUID()}`, sessionId: session, characterId: character.id, systemPrompt: '联系人验收', messages: [{ role: 'user', content: '验收组合设置：头像改为🐟，同时允许读取其他联系人共享的成果' }] }
  const combinationReply = await window.webContents.executeJavaScript(`window.electronAPI.ai.startStream(${JSON.stringify(combinationRequest)})`)
  const combination = await contactAgentsCall(character.id, 'pendingInteractions')
  const steps = combination.filter((card): card is ContactActionInteraction => card.kind === 'action' && card.request.configurationGroup?.id === combinationRequest.requestId).sort((a, b) => a.request.configurationGroup!.index - b.request.configurationGroup!.index)
  if (steps.length !== 2 || getContactProfile(character.id).profile.avatar === '🐟') throw new Error(`Combination did not create two unexecuted durable steps: ${JSON.stringify(combinationReply)}`)
  await window.webContents.executeJavaScript(`window.electronAPI.agents.submitInteraction(${JSON.stringify(character.id)},${JSON.stringify(steps[0].id)},{version:${JSON.stringify(steps[0].version)},actionId:'apply'})`)
  await restartAgentsForSmoke()
  const resumed = await contactAgentsCall(character.id, 'getInteraction', [steps[1].id])
  if (resumed.kind !== 'action' || resumed.status !== 'pending' || resumed.request.configurationGroup?.index !== 2) throw new Error('Unfinished configuration step did not survive restart')
  await window.webContents.executeJavaScript(`window.electronAPI.agents.submitInteraction(${JSON.stringify(character.id)},${JSON.stringify(resumed.id)},{version:${JSON.stringify(resumed.version)},actionId:'apply'})`)
  if (getContactProfile(character.id).profile.avatar !== '🐟' || !(await contactAgentsCall(character.id, 'get')).settings.readContactDeliveries) throw new Error('Combination did not save each independent setting')
  console.log('CHOUYU_SMOKE_CONTACT_COMBINATION_PASSED groupedCards=true separateReceipts=true resumeAfterRestart=true staleManualCredential=true')
  await contactAgentsCall(character.id, 'get')
  const deliveryStore = new ContactTaskStore(join(app.getPath('userData'), 'contact-agents', 'agents.db'))
  let topicId: string
  try {
    deliveryStore.save(character.id, { ...deliveryStore.overview(character.id).settings, notifyProgress: true }, Date.now(), false)
    const topic = deliveryStore.topics.create(character.id, { title: '阅读验收', goal: '写一份阅读样例', constraints: '' }); topicId = topic.id
    const run = deliveryStore.createRun(character.id, '', Date.now(), topic.id)
    deliveryStore.finish(run, { runId: run, title: '排版样例', body: '实际正文已保存', nextStep: '继续核对', evidence: [], createdAt: Date.now() }, [], { judgement: '已保存正文', openQuestions: '', nextStep: '继续核对', reason: '依据正文', status: 'researching' }, {
      completionCriteria: '完成阅读验收', summary: '实际正文', stages: [{ id: 'read', title: '阅读样例', status: 'active' }], section: { id: 'body', title: '一份可直接阅读的评审', body: '## 结论\n\n这份方案值得小范围试验。\n\n## 判断依据\n\n| 观察 | 限制 |\n| --- | --- |\n| 有明确需求 | 尚未验证付费 |\n\n保留所有依据，再决定是否投入。', output: { kind: 'review', density: 'comfortable' } }
    })
    for (const notice of deliveryStore.notices.pending(character.id)) { appendAgentNotice(notice); deliveryStore.notices.ack(character.id, notice.id) }
  } finally { deliveryStore.close() }
  await invoke('验收这次阅读：这次用正文阅读和舒适间距')
  const savedPreferences = await contactAgentsCall(character.id, 'outputPreferences', [topicId!, 1])
  if (savedPreferences[0].preference.kind !== 'review' || savedPreferences[2].preference.kind !== 'writing') throw new Error('Single delivery preference leaked into contact scope')
  selectChatSession(session); window.webContents.send('characters:changed'); window.webContents.send('sessions:changed')
  await window.webContents.executeJavaScript(`document.querySelector('[data-workspace-nav="chat"]')?.click(); document.querySelector('[aria-label="收起会话列表"]')?.click()`)
  try { await waitForRenderer(window, `Boolean(document.querySelector('[data-contact-output="writing"]'))`, 15000) }
  catch (error) { console.error('OUTPUT_SMOKE_DIAGNOSTIC', JSON.stringify({ saved: getSession(session)?.messages.map(m => ({ content: m.content.slice(0, 60), communication: m.communication })), ui: await window.webContents.executeJavaScript('document.body.innerText.slice(-10000)') })); throw error }
  if (process.env.CHOUYU_SMOKE_ARTIFACTS) {
    await window.webContents.executeJavaScript(`document.querySelector('[aria-label="最大化窗口"]')?.click()`)
    for (const theme of ['light', 'dark'] as const) {
      saveConfig({ theme }); window.webContents.send('config:changed', getConfig())
      for (const width of [375, 1024]) {
        window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 900 }, viewPosition: { x: 0, y: 0 }, viewSize: { width, height: 900 }, deviceScaleFactor: 1, scale: 1 })
        await waitForRenderer(window, `innerWidth === ${width}`)
        await window.webContents.executeJavaScript(`window.dispatchEvent(new Event('resize')); document.querySelector('[aria-label="收起会话列表"]')?.click(); document.querySelector('[data-contact-output="writing"]')?.scrollIntoView({block:'center'})`)
        await window.webContents.executeJavaScript(`new Promise(resolve=>setTimeout(resolve,350))`)
        const inside = await window.webContents.executeJavaScript(`(()=>{const r=document.querySelector('[data-contact-output="writing"]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight})()`)
        if (!inside) throw new Error('Output escaped the reading viewport')
        writeFileSync(join(process.env.CHOUYU_SMOKE_ARTIFACTS, `conversation-output-${theme}-${width}.png`), (await window.webContents.capturePage({ x: 0, y: 0, width, height: 900 }, { stayHidden: true, stayAwake: true })).toPNG())
      }
    }
    window.webContents.disableDeviceEmulation()
  }
  console.log('CHOUYU_SMOKE_CONTACT_OUTPUT_PASSED actualPreference=true singleVersion=true sharedChatRenderer=true')
  const current = await contactAgentsCall(character.id, 'get'), topic = current.topics.find(t => t.id === topicId!)!
  const args = { topicId: topic.id, revision: topic.revision, deliveryVersion: 1, action: 'accept', reason: '认可这版' }
  const prepared = await prepareRegisteredToolAsync('submit_contact_delivery_feedback', args, window, session)
  const feedback = await contactAgentsCall(character.id, 'offerAction', ['feedback-smoke', { purpose: 'feedback', title: '回应这份评审', body: prepared.preview!, sessionId: session, subject: { kind: 'delivery', topicId: topic.id, revision: topic.revision, version: 1 }, actions: [{ id: 'accept', label: '认可这版', tool: 'submit_contact_delivery_feedback', arguments: args }] }])
  appendContactAction(feedback); window.webContents.send('sessions:changed')
  const selector = `[data-contact-interaction="${feedback.id}"]`
  await waitForRenderer(window, `Boolean(document.querySelector(${JSON.stringify(selector)})?.querySelector('.primary'))`, 15000)
  await window.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).querySelector('.primary').click()`)
  await waitForRenderer(window, `document.querySelector(${JSON.stringify(selector)})?.textContent.includes('已记录你对版本 1 的认可')`, 15000)
  const accepted = await contactAgentsCall(character.id, 'get')
  if (accepted.topics.find(t => t.id === topic.id)!.status !== topic.status || accepted.runs.length !== current.runs.length) throw new Error('Acceptance changed continuous task state')
  const failureStore = new ContactTaskStore(join(app.getPath('userData'), 'contact-agents', 'agents.db'))
  let failureId: string
  try {
    const run = failureStore.createRun(character.id, '', Date.now(), topic.id)
    failureStore.fail(run, 'model not found')
    const notice = failureStore.notices.pending(character.id).find(n => n.runId === run && n.interactionId)!
    failureId = notice.interactionId!; appendAgentNotice(notice); failureStore.notices.ack(character.id, notice.id)
  } finally { failureStore.close() }
  window.webContents.send('sessions:changed')
  const failureSelector = `[data-contact-interaction="${failureId!}"]`
  await waitForRenderer(window, `Boolean(document.querySelector(${JSON.stringify(failureSelector)})?.querySelector('[data-remedy-control]'))`, 15000)
  await window.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(failureSelector)}).querySelector('[data-remedy-control]').click()`)
  await waitForRenderer(window, `Boolean(document.querySelector(${JSON.stringify(failureSelector)})?.querySelector('[aria-label="故障处理模型"]'))`, 15000)
  await window.webContents.executeJavaScript(`(()=>{const el=document.querySelector(${JSON.stringify(failureSelector)}).querySelector('[aria-label="故障处理模型"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'agent-smoke-recovered');el.dispatchEvent(new Event('input',{bubbles:true}));})()`)
  await window.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(failureSelector)}).querySelector('[data-remedy-save-model]').click()`)
  await waitForRenderer(window, `document.querySelector(${JSON.stringify(failureSelector)})?.textContent.includes('模型选择已保存')`, 15000)
  if (getContactProfile(character.id).profile.model !== 'agent-smoke-recovered' || getContactProfile(character.id).profile.soulMd !== '独立评审者') throw new Error('Failure remedy did not preserve unrelated profile fields')
  await window.webContents.executeJavaScript(`document.querySelector('[data-delivery-receipt]').click()`)
  await waitForRenderer(window, `Boolean(document.querySelector('[data-delivery-output-preference]'))`, 15000)
  await window.webContents.executeJavaScript(`document.querySelector('[data-delivery-output-preference]').click()`)
  await waitForRenderer(window, `Boolean(document.querySelector('[data-contact-output-dialog] button[type=submit]:not(:disabled)'))`)
  await window.webContents.executeJavaScript(`(()=>{const el=document.querySelector('[data-contact-output-dialog]').querySelectorAll('select')[2];Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'compact');el.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  const prior = (await contactAgentsCall(character.id, 'outputPreferences', [topic.id, 1]))[2]
  await contactAgentsCall(character.id, 'setOutputPreference', [{ kind: 'delivery', topicId: topic.id, version: 1 }, prior.revision, { kind: 'plain' }])
  await window.webContents.executeJavaScript(`document.querySelector('[data-contact-output-dialog] button[type=submit]').click()`)
  await waitForRenderer(window, `document.querySelector('[data-contact-output-dialog] [role=alert]')?.textContent.includes('变化')`)
  if (!await window.webContents.executeJavaScript(`document.querySelector('[data-contact-output-dialog]').querySelectorAll('select')[2].value==='compact'`)) throw new Error('Output conflict discarded the manual draft')
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await waitForRenderer(window, `!document.querySelector('[data-contact-output-dialog]') && Boolean(document.querySelector('[data-delivery-output-preference]'))`)
  await window.webContents.executeJavaScript(`document.querySelector('[data-delivery-output-preference]').click()`)
  await waitForRenderer(window, `Boolean(document.querySelector('[data-contact-output-dialog] button[type=submit]:not(:disabled)'))`)
  await window.webContents.executeJavaScript(`(()=>{const el=document.querySelector('[data-contact-output-dialog]').querySelectorAll('select')[2];Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'compact');el.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  await window.webContents.executeJavaScript(`document.querySelector('[data-contact-output-dialog] button[type=submit]').click()`)
  await waitForRenderer(window, `!document.querySelector('[data-contact-output-dialog]')`)
  if ((await contactAgentsCall(character.id, 'outputPreferences', [topic.id, 1]))[2].preference.density !== 'compact') throw new Error('Manual output preference did not persist')
  console.log('CHOUYU_SMOKE_CONTACT_OUTPUT_DIALOG_PASSED fixedVersion=true staleWriteRejected=true draftPreserved=true escapeKeepsReader=true saved=true')
  console.log('CHOUYU_SMOKE_CONTACT_FEEDBACK_PASSED clickedAcceptance=true fixedVersion=true unchangedTask=true directModelRemedy=true')
  console.log('CHOUYU_SMOKE_CONTACT_CONVERSATION_PASSED profile=true permissions=true skill=true rejectedApproval=true staleManual=true builtIn=true noTask=true naturalCardReply=true secureCredential=true')
}
