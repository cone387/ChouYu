import type { BrowserWindow } from 'electron'
import type { AIChatMessage } from '../../shared/ai'

/** Exercise the real card IPC after a chat request, leaving automatic tools unchanged. */
export function invokeContactChat(window: BrowserWindow, request: { requestId: string; characterId: string; sessionId: string; systemPrompt: string; messages: AIChatMessage[] }, approved = true) {
  return window.webContents.executeJavaScript(`(async()=>{
    const owner=${JSON.stringify(request.characterId)}, session=${JSON.stringify(request.sessionId)};
    const before=new Set((await window.electronAPI.agents.pendingInteractions(owner)).map(c=>c.id));
    const response=await window.electronAPI.ai.startStream(${JSON.stringify(request)});
    const cards=(await window.electronAPI.agents.pendingInteractions(owner)).filter(c=>c.kind==='action'&&c.characterId===owner&&c.request.sessionId===session&&!before.has(c.id));
    if(cards.length>1)throw new Error('One chat unexpectedly offered multiple actions');
    if(cards.length){const card=cards[0];const saved=await window.electronAPI.agents.submitInteraction(owner,card.id,{version:card.version,...(${approved}?{actionId:'apply'}:{reject:true})});response.reply=saved.result;}
    return {response,approvals:cards.map(card=>({...card,preview:card.request.body}))};
  })()`)
}
