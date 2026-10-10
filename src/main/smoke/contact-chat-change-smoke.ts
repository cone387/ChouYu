import { app, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { AgentStore } from '../agents/store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { createCharacter, createChatSession, listCharacters } from '../database'

export async function runContactChatChangeSmoke(window: BrowserWindow) {
  if (process.env.CHOUYU_SMOKE_TEST !== '1') throw new Error('Isolated smoke only')
  const template = listCharacters().find(c => !c.builtIn) || listCharacters()[0]
  const character = createCharacter({ ...template, name: '聊天修改验收', model: 'agent-smoke' })
  const session = createChatSession('聊天修改验收', character.id).activeSession.id
  const directory = join(app.getPath('userData'), 'contact-agents')
  mkdirSync(directory, { recursive: true })
  const store = new AgentStore(join(directory, 'agents.db'))
  let topicId: string
  try {
    store.save(character.id, { ...DEFAULT_AGENT_SETTINGS, goal: '评价产品idea', enabled: false })
    const topic = store.overview(character.id).topics[0]; topicId = topic.id
    store.changeTopic(character.id, topic.id, topic.revision, { status: 'paused', reason: '验收暂停状态保持' })
  } finally { store.close() }
  const request = { requestId: 'chat-change-smoke', sessionId: session, characterId: character.id, systemPrompt: '你是一个联系人。', messages: [{ role: 'user', content: '验收聊天修改：以后一次汇报一个。' }] }
  const result = await window.webContents.executeJavaScript(`(async()=>{
    let text='', completed=false;
    const off=window.electronAPI.ai.onStreamEvent(e=>{if(e.requestId!==${JSON.stringify(request.requestId)})return;if(e.done)completed=true;else text+=e.chunk;});
    try { const response=await window.electronAPI.ai.startStream(${JSON.stringify(request)});return {response,text:response.reply??text,completed:response.reply!==undefined||completed}; }finally{off();}
  })()`)
  if (!result.response.ok || !result.text.includes('已保存') || !result.completed) throw new Error(`Chat change did not stream a truthful visible receipt: ${JSON.stringify(result)}`)
  const saved = await window.webContents.executeJavaScript(`window.electronAPI.agents.get(${JSON.stringify(character.id)})`)
  const topic = saved.topics.find((t: { id: string }) => t.id === topicId)
  if (!topic.separateEvaluations || !topic.constraints.includes('一个') || !topic.requestLog.includes(request.messages[0].content) || topic.status !== 'paused') throw new Error('Chat change was not durably applied or resumed a paused task')
  console.log('CHOUYU_SMOKE_CHAT_CHANGE_PASSED routed=true persisted=true receipt=true pausedPreserved=true')
}
