import { app, type BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCharacter, createChatSession, getContactProfile, getConfig, listCharacters, getSession, getState, contactSearchCredential } from '../database'
import { AgentStore } from '../agents/store'
import { contactSkillLibrary } from '../skills'
import { DEFAULT_CHARACTER_ID } from '../../shared/characters'

/** Real registered tools/approval/IPC/storage with a local model fixture. */
export async function runContactConversationSmoke(window: BrowserWindow) {
  if (process.env.CHOUYU_SMOKE_TEST !== '1') throw new Error('Isolated smoke only')
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
  const work = await window.webContents.executeJavaScript(`window.electronAPI.agents.get(${JSON.stringify(character.id)})`)
  if (work.topics.length || work.settings.permissionLevel !== 'sources' || work.settings.sources[0] !== 'https://example.com/' || work.settings.notifyProgress !== false || work.settings.shareDeliveries !== true) throw new Error('No-task permissions were not saved accurately')
  const denied = await invoke('验收对话技能：启用评审说明', character.id, session, false)
  if (!denied.approvals.length || contactSkillLibrary().snapshot(character.id).entries.length) throw new Error('Rejected skill confirmation changed permissions')
  const skill = await invoke('验收对话技能：启用评审说明')
  if (!skill.response.ok || !skill.response.reply?.includes('已启用')) throw new Error(`Skill chat receipt failed: ${JSON.stringify(skill)}`)
  if (contactSkillLibrary().snapshot(character.id).entries[0]?.id !== 'conversation-review' || contactSkillLibrary().snapshot(character.id).entries[0]?.scriptsEnabled) throw new Error('Skill enable did not preserve independent script authorization')
  const credentialRequest = { requestId: `credential-${crypto.randomUUID()}`, sessionId: session, characterId: character.id, systemPrompt: '联系人验收', messages: [{ role: 'user', content: '验收搜索安全输入：更新我的搜索密钥' }] }
  const secure = await window.webContents.executeJavaScript(`(async()=>{
    const reply=await window.electronAPI.ai.startStream(${JSON.stringify(credentialRequest)});
    if(!reply.ok)throw new Error('Credential card routing failed');
    const card=(await window.electronAPI.agents.pendingInteractions(${JSON.stringify(character.id)})).find(c=>c.kind==='action'&&c.request.input?.argument==='credential');
    if(!card)throw new Error('Missing secure credential card');
    return window.electronAPI.agents.submitInteraction(card.characterId,card.id,{version:card.version,actionId:'apply',credential:'fixture-private-search-value'});
  })()`)
  if (secure.status !== 'resolved' || !contactSearchCredential(character.id).configured || getState(`agent-search:${character.id}:api_key`) !== 'fixture-private-search-value') throw new Error('Secure input did not persist the actual credential')
  const storage = new AgentStore(join(app.getPath('userData'), 'contact-agents', 'agents.db'))
  try {
    const row = storage.db.prepare('SELECT value FROM contact_interactions WHERE id=?').get(secure.id) as { value: string }
    if (row.value.includes('fixture-private-search-value') || JSON.stringify(getSession(session)).includes('fixture-private-search-value')) throw new Error('Credential leaked into card or conversation storage')
  } finally { storage.close() }
  const assistantSession = createChatSession('内置资料验收', DEFAULT_CHARACTER_ID).activeSession.id
  const assistant = await invoke('验收对话内置：模型改为agent-smoke-built-in', DEFAULT_CHARACTER_ID, assistantSession)
  if (!assistant.response.ok || !assistant.response.reply?.includes('已保存') || getConfig().model !== 'agent-smoke-built-in') throw new Error(`Built-in effective model was not saved: ${JSON.stringify(assistant)}`)
  if (getContactProfile(character.id).profile.model !== 'agent-smoke-next') throw new Error('Built-in change overwrote another contact override')
  console.log('CHOUYU_SMOKE_CONTACT_CONVERSATION_PASSED profile=true permissions=true skill=true rejectedApproval=true staleManual=true builtIn=true noTask=true naturalCardReply=true secureCredential=true')
}
