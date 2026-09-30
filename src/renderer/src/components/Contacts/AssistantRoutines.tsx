import { useEffect, useState } from 'react'
import type { AssistantRoutine, AssistantRoutineInput } from '../../../../shared/assistant-routines'
import './AssistantRoutines.css'

const fresh = (): AssistantRoutineInput => ({ title: '联系人晨间总结', instruction: '检查各联系人的工作进展，汇总最近变化、遇到的问题和等待我答复的事项。', time: '09:00', cadence: 'daily', kind: 'contact-summary', enabled: true })
export default function AssistantRoutines() {
  const [items, setItems] = useState<AssistantRoutine[]>([])
  const [draft, setDraft] = useState<AssistantRoutineInput | null>(null)
  const [editing, setEditing] = useState<AssistantRoutine>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [removing, setRemoving] = useState<string>()
  const refresh = () => window.electronAPI.assistantRoutines.list().then(value => { setItems(value); setLoaded(true); setError('') }).catch(e => setError(String(e)))
  useEffect(() => { void refresh(); const timer = setInterval(() => { void refresh() }, 15000); return () => clearInterval(timer) }, [])
  const act = async (action: () => Promise<AssistantRoutine[]>) => {
    setBusy(true); setError('')
    try { setItems(await action()); setDraft(null); setEditing(undefined); setRemoving(undefined) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return <section className="assistant-routines" aria-label="ChouYu 的长期安排">
    <div className="assistant-routines-heading"><h3>我的长期安排</h3><button type="button" disabled={busy || !!draft || !loaded} onClick={() => { setEditing(undefined); setDraft(fresh()) }}>添加安排</button></div>
    <p>到点提醒你，或先检查各联系人的进展再向你汇报。也可以直接在聊天里交代我。</p>
    <p className="assistant-routines-help">按电脑本地时间执行。应用退出期间不执行，重新打开后合并补执行一次。联系人总结使用你的 AI 模型。</p>
    {error && <div role="alert">{error} <button type="button" disabled={busy} onClick={() => void refresh()}>刷新</button></div>}
    {!loaded && !error && <p role="status">正在读取安排…</p>}
    {loaded && !items.length && !draft && <p>还没有长期安排。可以从每天早上的联系人总结开始。</p>}
    {items.map(item => <article key={item.id}>
      <div className="assistant-routines-heading"><strong>{item.title}</strong><span>{item.enabled ? '已启用' : '已暂停'}</span></div>
      <p>{item.cadence === 'daily' ? '每天' : item.cadence === 'weekdays' ? '工作日' : `每周${'日一二三四五六'[item.weekday ?? 0]}`} {item.time} · {item.kind === 'contact-summary' ? '检查联系人并总结' : '定时提醒'}</p>
      {item.enabled && <p>{item.retryAt ? '下次重试' : '下次执行'}：{new Date(item.retryAt ?? item.nextAt).toLocaleString()}</p>}
      {item.lastAt && <p>上次完成：{new Date(item.lastAt).toLocaleString()} · 已发到聊天</p>}
      {item.lastError && <p role="status">最近执行未成功：{item.lastError}（会自动重试）</p>}
      {item.lastResult && <details><summary>最近结果</summary><p className="assistant-routine-result">{item.lastResult}</p></details>}
      <div className="assistant-routines-actions">
        <button type="button" disabled={busy || !!draft} onClick={() => { setEditing(item); setDraft({ ...item }) }}>修改</button>
        <button type="button" disabled={busy || !!draft} onClick={() => void act(() => window.electronAPI.assistantRoutines.save({ ...item, enabled: !item.enabled }, item.id, item.revision))}>{item.enabled ? '暂停' : '恢复'}</button>
        {removing === item.id ? <><span>删除这项安排？</span><button type="button" disabled={busy} onClick={() => void act(() => window.electronAPI.assistantRoutines.remove(item.id, item.revision))}>确认删除</button><button type="button" disabled={busy} onClick={() => setRemoving(undefined)}>取消</button></> : <button type="button" disabled={busy || !!draft} onClick={() => setRemoving(item.id)}>删除</button>}
      </div>
    </article>)}
    {draft && <form onSubmit={event => { event.preventDefault(); void act(() => window.electronAPI.assistantRoutines.save(draft, editing?.id, editing?.revision)) }}>
      <h4>{editing ? '修改安排' : '添加安排'}</h4>
      <label>名称<input autoFocus required maxLength={100} value={draft.title} disabled={busy} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
      <label>要做的事<select value={draft.kind} disabled={busy} onChange={e => setDraft({ ...draft, kind: e.target.value as AssistantRoutineInput['kind'] })}><option value="contact-summary">检查联系人并总结</option><option value="reminder">定时提醒</option></select></label>
      <label>{draft.kind === 'contact-summary' ? '总结时关注什么' : '提醒内容'}<textarea required maxLength={2000} rows={3} disabled={busy} value={draft.instruction} onChange={e => setDraft({ ...draft, instruction: e.target.value })} /></label>
      <div className="assistant-routines-schedule">
        <label>重复<select value={draft.cadence} disabled={busy} onChange={e => setDraft({ ...draft, cadence: e.target.value as AssistantRoutineInput['cadence'], weekday: draft.weekday ?? 1 })}><option value="daily">每天</option><option value="weekdays">工作日</option><option value="weekly">每周</option></select></label>
        {draft.cadence === 'weekly' && <label>星期<select disabled={busy} value={draft.weekday ?? 1} onChange={e => setDraft({ ...draft, weekday: Number(e.target.value) })}>{Array.from('日一二三四五六').map((day, i) => <option key={i} value={i}>周{day}</option>)}</select></label>}
        <label>本地时间<input type="time" required value={draft.time} disabled={busy} onChange={e => setDraft({ ...draft, time: e.target.value })} /></label>
      </div>
      <div className="assistant-routines-actions"><button type="submit" disabled={busy}>{busy ? '正在保存…' : '保存安排'}</button><button type="button" disabled={busy} onClick={() => { setDraft(null); setEditing(undefined) }}>取消</button></div>
    </form>}
  </section>
}
