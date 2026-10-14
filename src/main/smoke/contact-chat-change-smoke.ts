import { app, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { AgentStore } from '../agents/store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { createCharacter, createChatSession, listCharacters } from '../database'
import { invokeContactChat } from './contact-card-helper'

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
    store.save(character.id, { ...DEFAULT_AGENT_SETTINGS, goal: '评价产品idea', enabled: false, defaultTaskTokenLimit: 5000 })
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
  const fixture = new AgentStore(join(directory, 'agents.db'))
  let runId: string
  try {
    fixture.changeTopic(character.id, topicId, topic.revision, { status: 'planned', reason: '隔离验收已有工作' })
    runId = fixture.createRun(character.id, '', Date.now(), topicId)
    fixture.wait(runId, '请确定这次评价面向哪个行业？')
  } finally { fixture.close() }
  const continuation = { ...request, requestId: 'chat-continue-existing-smoke', messages: [{ role: 'user', content: '验收已有工作：继续' }] }
  const existing = await window.webContents.executeJavaScript(`(async()=>{
    const events=[];
    const off=window.electronAPI.ai.onToolEvent(e=>{if(e.requestId===${JSON.stringify(continuation.requestId)})events.push(e);});
    try { const response=await window.electronAPI.ai.startStream(${JSON.stringify(continuation)});return {response,events}; }finally{off();}
  })()`)
  if (!existing.response.ok || existing.events.some((e: { status: string }) => ['error', 'requested', 'denied', 'expired'].includes(e.status)) || !existing.events.some((e: { name: string; status: string; summary: string }) => e.name === 'update_contact_topic' && e.status === 'completed' && e.summary.includes('请确定这次评价面向哪个行业？'))) throw new Error(`Existing work was not returned without approval/failure: ${JSON.stringify(existing)}`)
  const after = await window.webContents.executeJavaScript(`window.electronAPI.agents.get(${JSON.stringify(character.id)})`)
  if (after.runs.length !== 1 || after.runs[0].id !== runId || after.runs[0].status !== 'waiting' || after.runs[0].answer) throw new Error('Continuation duplicated or answered the pending round')
  console.log('CHOUYU_SMOKE_CONTINUE_EXISTING_PASSED question=true noApproval=true noFailure=true sameRun=true')
  const invoke = async (content: string, approved = true) => {
    const next = { ...request, requestId: `chat-control-${Date.now()}`, messages: [{ role: 'user', content }] }
    return invokeContactChat(window, { ...next, messages: next.messages as import('../../shared/ai').AIChatMessage[] }, approved)
  }
  const hours = await invoke('验收工作时间：以后只在20:00到23:00工作')
  if (!hours.response.ok || !hours.response.reply?.includes('已保存')) throw new Error(`Working hours receipt failed: ${JSON.stringify(hours)}`)
  let current = await window.webContents.executeJavaScript(`window.electronAPI.agents.get(${JSON.stringify(character.id)})`)
  if (current.settings.workHours?.start !== '20:00' || current.settings.workHours?.end !== '23:00' || current.settings.enabled) throw new Error('Chat work settings were not saved or enabled work without permission')
  const ended = await invoke('验收结束任务：这项任务到这里结束，保留成果')
  if (!ended.response.ok || !ended.response.reply?.includes('已结束')) throw new Error(`End receipt failed: ${JSON.stringify(ended)}`)
  current = await window.webContents.executeJavaScript(`window.electronAPI.agents.get(${JSON.stringify(character.id)})`)
  if (current.topics[0].status !== 'completed' || current.runs.find((r: { id: string }) => r.id === runId)?.status !== 'cancelled') throw new Error('End did not stop the original round')
  if (current.topics[0].tokenLimit !== 5000) throw new Error('The existing Token cap was lost before its explicit removal')
  const unlimited = await invoke('验收解除上限：取消这个任务的Token上限')
  if (!unlimited.response.ok || !unlimited.response.reply?.includes('已保存')) throw new Error('Token removal did not save')
  current = await window.webContents.executeJavaScript(`window.electronAPI.agents.get(${JSON.stringify(character.id)})`)
  if (current.topics[0].status !== 'completed' || current.topics[0].tokenLimit !== undefined) throw new Error('Token removal resumed ended task')
  // Even fully automatic contact tools must preserve the single-task deletion scope confirmation.
  await window.webContents.executeJavaScript(`window.electronAPI.agents.savePreferences(${JSON.stringify(character.id)},${JSON.stringify({ ...current.settings, toolPermissionMode: 'full' })},${current.revision})`)
  const denied = await invoke('验收删除任务：删除这项任务及其成果和历史', false)
  if (denied.approvals.length !== 1 || !denied.approvals[0].preview?.includes('成果')) throw new Error('Deletion bypassed the scope confirmation')
  current = await window.webContents.executeJavaScript(`window.electronAPI.agents.get(${JSON.stringify(character.id)})`)
  if (!current.topics.some((t: { id: string }) => t.id === topicId)) throw new Error('Rejected deletion removed the task')
  const deleted = await invoke('验收删除任务：删除这项任务及其成果和历史')
  if (deleted.approvals.length !== 1 || !deleted.response.reply?.includes('已删除')) throw new Error('Confirmed deletion did not return its real receipt')
  current = await window.webContents.executeJavaScript(`window.electronAPI.agents.get(${JSON.stringify(character.id)})`)
  if (current.topics.length) throw new Error('Deleted task still exists')
  console.log('CHOUYU_SMOKE_CHAT_CONTROLS_PASSED settings=true end=true tokenRemoval=true deletionConfirmation=true')
  console.log('CHOUYU_SMOKE_CHAT_CHANGE_PASSED routed=true persisted=true receipt=true pausedPreserved=true')
}
