import { useEffect, useRef, useState } from 'react'
import type { AgentTopic } from '../../../../shared/agents'
import { TOPIC_STATUS } from '../../../../shared/agents'
import type { ContentCitation } from '../../../../shared/contact-content'
import type { HandoffState } from '../../../../shared/contact-handoffs'
import ContactRevisionDialog from './ContactRevisionDialog'
import { navigateContact } from './contactNavigation'
export default function ContactHandoffs({ owner, topicId, getCitation }: { owner: string; topicId: string; getCitation(): Promise<ContentCitation> }) {
  const [states, setStates] = useState<HandoffState[]>([]), [names, setNames] = useState<Record<string, string>>({}), [error, setError] = useState('')
  const [revision, setRevision] = useState<{ topic: AgentTopic; source: ContentCitation; review: ContentCitation; handoffId: string } | null>(null), alive = useRef(true)
  useEffect(() => {
    alive.current = true; let epoch = 0
    const refresh = async () => {
      const current = ++epoch
      try { const handoffs = await window.electronAPI.agents.handoffs(owner, topicId); const values = await Promise.all(handoffs.map(h => window.electronAPI.agents.handoffState(owner, h.id))); if (alive.current && current === epoch) setStates(values) }
      catch { if (alive.current && current === epoch) setError('暂时无法读取交接记录。') }
    }
    void refresh(); void window.electronAPI.characters.list().then(items => { if (alive.current) setNames(Object.fromEntries(items.map(c => [c.id, c.name]))) })
    const off = window.electronAPI.agents.onChanged(() => void refresh())
    return () => { alive.current = false; off() }
  }, [owner, topicId])
  const returnReview = async (state: HandoffState) => {
    try {
      const review = await getCitation(), overview = await window.electronAPI.agents.get(state.handoff.source.characterId), topic = overview.topics.find(t => t.id === state.handoff.source.topicId)
      if (!topic) throw new Error('原任务已移除。')
      if (alive.current) setRevision({ topic, source: { ref: { ...state.handoff.source, version: state.reviewedVersion ?? state.handoff.source.version } }, review, handoffId: state.handoff.id })
    } catch (reason) { if (alive.current) setError(String(reason)) }
  }
  const navigate = (fn: () => Promise<void>) => { void fn().catch(reason => { if (alive.current) setError(String(reason)) }) }
  if (!states.length && !error) return null
  return <section className="contact-handoffs"><h4>评审交接</h4>{error && <p role="alert">{error}</p>}{states.map(state => <article key={state.handoff.id} data-handoff-record={state.handoff.id}>
    <p>{names[state.handoff.source.characterId] || '原作者'} → {names[state.handoff.recipientId] || '接收者'} · {TOPIC_STATUS[state.status as keyof typeof TOPIC_STATUS] || state.status}</p>
    <p className="agent-caption">{state.reviewedVersion ? `已评审原文第 ${state.reviewedVersion} 版` : `交接原文第 ${state.handoff.source.version} 版，尚未完成评审`}{state.latestVersion > (state.reviewedVersion ?? state.handoff.source.version) ? ` · 原文已有第 ${state.latestVersion} 版，尚未评审` : ''}{state.handoff.continuous ? ' · 持续跟进正文变化' : ' · 仅本次交接'}</p>
    <div className="agent-actions"><button type="button" onClick={() => navigate(() => navigateContact({ kind: 'delivery', ref: state.handoff.source }))}>交接原文</button><button type="button" onClick={() => navigate(() => navigateContact({ kind: 'task', characterId: state.handoff.recipientId, topicId: state.handoff.topicId }))}>评审任务</button>{owner === state.handoff.recipientId && <button type="button" data-return-review onMouseDown={e => e.preventDefault()} onClick={() => void returnReview(state)}>将所选意见交回作者</button>}</div>
  </article>)}
    {revision && <ContactRevisionDialog characterId={revision.source.ref.characterId} topic={revision.topic} citation={revision.source} review={{ handoffId: revision.handoffId, citation: revision.review }} onClose={() => setRevision(null)} onSaved={() => setError('意见已交回，原作者将按你的修改要求修订。')} />}
  </section>
}
