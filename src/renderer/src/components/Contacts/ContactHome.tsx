import { contactQueries } from './contactQueries'
import { useEffect, useState } from 'react'
import type { AgentOverview } from '../../../../shared/agents'
import type { ContactHomeData } from '../../../../shared/contact-home'
import { DEFAULT_CHARACTER_ID } from '../../../../shared/characters'
import ContactInteractionCard from '../ChatPanel/ContactInteractionCard'
import ContactTaskListCard from './ContactTaskListCard'
import { contactTaskItems } from './contactTaskPresentation'
import { useAssistantTasks } from './useAssistantTasks'
import ContactDailyOverview from './ContactDailyOverview'
import { navigateContact } from './contactNavigation'
import './ContactHome.css'

export default function ContactHome({ characterId, overview, onTask, active = true }: { active?: boolean; characterId: string; overview: AgentOverview | null; onTask(topicId: string): void }) {
  const [data, setData] = useState<ContactHomeData>(), [error, setError] = useState(''), [reload, setReload] = useState(0), [statistics, setStatistics] = useState(false)
  const assistant = useAssistantTasks(characterId === DEFAULT_CHARACTER_ID, active)
  useEffect(() => {
    if (!active) return
    let live = true, sequence = 0
    setError('')
    const refresh = async () => { const n = ++sequence; try { const next = await contactQueries.read(characterId, 'contactHome', [], () => window.electronAPI.agents.contactHome(characterId)); if (live && n === sequence) { setData(next); setError('') } } catch (e) { if (live && n === sequence) setError(e instanceof Error ? e.message : '读取失败') } }
    const dispose = contactQueries.watch(characterId, refresh, 15000)
    return () => { live = false; dispose() }
  }, [characterId, reload, active])
  if (!data) return <section data-contact-home>{error ? <p role="alert">{error}<button type="button" onClick={() => setReload(n => n + 1)}>重新读取</button></p> : <p role="status">正在读取联系人近况…</p>}</section>
  const items = overview ? contactTaskItems(overview, assistant.entries).filter(item => !item.template && (item.scheduled ? item.status === '已启用' && !item.scheduled.routine?.finishedAt : item.work && !['paused', 'completed', 'abandoned'].includes(item.work.status))) : []
  return <section className="contact-home" data-contact-home>
    {error && <p role="alert">{error}<button type="button" onClick={() => setReload(n => n + 1)}>重新读取</button></p>}
    <section data-home-pending><h3>等你回应</h3>{!data.pending.length && <p className="agent-caption">目前没有需要你处理的事项。</p>}{data.pending.map(item => <ContactInteractionCard key={item.id} active={active} characterId={characterId} interactionId={item.id} fallback={item.question || item.topicTitle} onOpen={() => onTask(item.topicId)} />)}</section>
    <section data-home-deliveries><h3>最近交付</h3>{!data.recentDeliveries.length && <p className="agent-caption">还没有正式保存的成果。</p>}<ul className="contact-home-deliveries">{data.recentDeliveries.map(item => <li key={item.ref.topicId}><button type="button" onClick={() => void navigateContact({ kind: 'delivery', ref: item.ref }).catch(e => setError(String(e)))}><strong>{item.title}</strong><p>{item.excerpt}</p><span className="agent-caption">第 {item.ref.version} 版 · {new Date(item.createdAt).toLocaleString()}</span></button></li>)}</ul></section>
    <section data-home-tasks><h3>当前任务与安排</h3>{assistant.error && <p role="alert">{assistant.error}</p>}{!items.length && <p className="agent-caption">目前没有正在推进的任务或已启用的安排。</p>}<div className="contact-home-tasks">{items.slice(0, 6).map(item => <ContactTaskListCard key={item.id} item={{ ...item, canDelete: false }} selected={false} disabled={false} onSelect={() => onTask(item.id)} onDelete={() => {}} />)}</div>{items.length > 6 && <button type="button" onClick={() => onTask(items[6].id)}>查看全部任务（{items.length}）</button>}</section>
    <details onToggle={e => setStatistics(e.currentTarget.open)}><summary>工作时间图、统计与日志</summary>{statistics && <ContactDailyOverview active={active} characterId={characterId} />}</details>
  </section>
}
