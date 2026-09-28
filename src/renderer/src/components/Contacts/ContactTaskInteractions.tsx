import { useEffect, useRef, useState } from 'react'
import type { AgentInteraction, AgentInteractionPage } from '../../../../shared/agents'

export default function ContactTaskInteractions({ characterId, topicId, visible, onReply, onReport }: {
  characterId: string; topicId: string; visible: boolean; onReply(): void; onReport(runId: string): void
}) {
  const [page, setPage] = useState<AgentInteractionPage>({ items: [] })
  const [loading, setLoading] = useState(true), [error, setError] = useState('')
  const epoch = useRef(0)
  const load = async (cursor?: number) => {
    const request = ++epoch.current
    setLoading(true); setError('')
    try {
      const next = await window.electronAPI.agents.interactions(characterId, topicId, cursor)
      if (request !== epoch.current) return
      setPage(previous => cursor ? { ...next, items: [...previous.items, ...next.items].filter((item, index, items) => items.findIndex(other => other.id === item.id) === index) } : next)
    } catch (e) { if (request === epoch.current) setError(e instanceof Error ? e.message : '互动记录读取失败。') }
    finally { if (request === epoch.current) setLoading(false) }
  }
  useEffect(() => {
    if (!visible) return
    void load()
    const dispose = window.electronAPI.agents.onChanged(id => { if (id === characterId) void load() })
    return () => { epoch.current++; dispose() }
  }, [characterId, topicId, visible])
  return <div className="topic-interactions" data-topic-interactions>
    <h4>互动记录</h4><p className="agent-caption">按时间倒序保存每次确认问题和你的回复，任务结束后仍可查看。</p>
    {error && <p className="agent-error" role="alert">{error}<button type="button" onClick={() => void load()}>重试</button></p>}
    {loading && <p role="status">正在读取互动记录…</p>}
    {!loading && !error && !page.items.length && <p className="agent-empty">还没有需要确认的问题。需要补充信息时，联系人会在聊天里发来确认卡片。</p>}
    <ol>{page.items.map((item: AgentInteraction) => <li key={item.id} className={`topic-interaction-card ${item.kind === 'answer' ? 'is-answer' : ''}`} data-interaction-kind={item.kind}>
      <header><strong>{item.kind === 'answer' ? '你的回复' : '任务确认'}</strong><time dateTime={new Date(item.at).toISOString()}>{new Date(item.at).toLocaleString('zh-CN', { hour12: false })}</time></header>
      <p>{item.text}</p>
      <div className="agent-actions">{item.pending ? <button type="button" className="primary" onClick={onReply}>回复并继续</button> : <span className="agent-caption">{item.kind === 'answer' ? '回复已记录' : '历史确认问题'}</span>}<button type="button" onClick={() => onReport(item.runId)}>查看本轮记录</button></div>
    </li>)}</ol>
    {page.nextCursor && <button type="button" disabled={loading} onClick={() => void load(page.nextCursor)}>更早的互动</button>}
  </div>
}
