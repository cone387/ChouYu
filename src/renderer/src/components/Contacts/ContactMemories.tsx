import { useEffect, useRef, useState } from 'react'
import type { AgentOverview } from '../../../../shared/agents'
import { MEMORY_KIND_LABELS, type ContactMemory } from '../../../../shared/contact-memories'
import ContactMemoryDialog from './ContactMemoryDialog'

export function memorySource(memory: ContactMemory) {
  return ({ user: '你告诉我的', research: '研究记录', conversation: '聊天记录', delivery: '已保存成果' })[memory.source.kind]
}
export default function ContactMemories({ characterId, name, data, onSaved }: { characterId: string; name: string; data: AgentOverview; onSaved: (data: AgentOverview) => void }) {
  const [items, setItems] = useState<ContactMemory[]>([]), [editing, setEditing] = useState<ContactMemory | 'new' | null>(null)
  const [history, setHistory] = useState<Record<string, ContactMemory[]>>({}), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let alive = true, generation = 0
    const refresh = async () => {
      const request = ++generation
      try { const result = await window.electronAPI.agents.memoryList(characterId); if (alive && request === generation) { setItems(result); setHistory({}) } }
      catch (reason) { if (alive && request === generation) setError(String(reason)) }
    }
    void refresh()
    const off = window.electronAPI.agents.onChanged(id => { if (id === characterId) void refresh() })
    return () => { alive = false; off() }
  }, [characterId])
  const scope = (m: ContactMemory) => m.scope.kind === 'contact' ? '所有工作与对话' : m.scope.kind === 'session' ? '指定会话' : `任务：${data.topics.find(t => m.scope.kind === 'task' && t.id === m.scope.topicId)?.title || '已移除'}`
  const act = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn() } catch (reason) { if (mounted.current) setError(String(reason).replace(/^Error: Error invoking remote method '[^']+': (?:Error: )?/, '')) } finally { if (mounted.current) setBusy(false) } }
  return <>
    <p className="agent-description">只属于{name}。研究判断和共同经历先保存为待确认记忆，确认后才用于工作与对话。</p>
    <button type="button" data-contact-memory-new disabled={busy} onClick={() => setEditing('new')}>新增记忆</button>
    {editing && <ContactMemoryDialog characterId={characterId} name={name} topics={data.topics} memory={editing === 'new' ? undefined : editing} onSaved={onSaved} onClose={() => setEditing(null)} />}
    {error && <p role="alert" className="agent-error">{error}</p>}
    {!items.length && <p className="agent-empty">独立记忆还是空的，可以记住偏好、项目背景或共同经历。</p>}
    <ul className="agent-memories">{items.map(memory => <li key={memory.id} data-memory-id={memory.id}>
      <p>{memory.content}</p>
      <div className="agent-memory-footer"><span className="agent-caption">{MEMORY_KIND_LABELS[memory.kind]} · {scope(memory)} · {memorySource(memory)} · 第 {memory.revision} 版{memory.status === 'candidate' ? ' · 待确认' : ''}</span>
        <button type="button" data-memory-edit disabled={busy} onClick={() => setEditing(memory)}>{memory.status === 'candidate' ? '确认或修正' : '纠正'}</button>
        <button type="button" data-memory-history disabled={busy} onClick={() => void act(async () => { const versions = await window.electronAPI.agents.memoryHistory(characterId, memory.id); setHistory(h => ({ ...h, [memory.id]: versions })) })}>历史与来源</button>
        <button type="button" data-memory-forget disabled={busy} aria-label={`忘记：${memory.content.slice(0, 20)}`} onClick={() => void act(async () => { await window.electronAPI.agents.forgetMemory(characterId, memory.id, memory.revision); const next = await window.electronAPI.agents.get(characterId); if (mounted.current) onSaved(next) })}>忘记</button>
      </div>
      {history[memory.id] && <ol>{history[memory.id].map(version => <li key={version.revision}><span className="agent-caption">第 {version.revision} 版 · {memorySource(version)} · {scope(version)} · {new Date(version.updatedAt).toLocaleString()}</span><p>{version.status === 'forgotten' ? '此记忆已移除。' : version.content}</p></li>)}</ol>}
    </li>)}</ul>
    <p className="agent-caption">最多 100 条，包含待确认记忆。纠正和忘记后，受影响的工作将停止；历史成果仍保留。</p>
  </>
}
