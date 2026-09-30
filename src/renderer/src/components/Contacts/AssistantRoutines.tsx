import { useEffect, useState } from 'react'
import type { AssistantRoutine, AssistantRoutineInput } from '../../../../shared/assistant-routines'
import { ASSISTANT_DUTIES, type AssistantDutyKey } from '../../../../shared/assistant-duties'
import type { AppConfig } from '../../../../shared/config'
import './AssistantRoutines.css'

const fresh = (): AssistantRoutineInput => ({ title: '联系人晨间总结', instruction: '检查各联系人的工作进展，汇总最近变化、遇到的问题和等待我答复的事项。', time: '', cadence: 'daily', kind: 'contact-summary', enabled: true })
export default function AssistantRoutines({ active = true }: { active?: boolean }) {
  const [items, setItems] = useState<AssistantRoutine[]>([])
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [draft, setDraft] = useState<AssistantRoutineInput | null>(null)
  const [editing, setEditing] = useState<AssistantRoutine>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [removing, setRemoving] = useState<string>()
  const refresh = () => Promise.all([window.electronAPI.assistantRoutines.list(), window.electronAPI.db.getConfig()]).then(([value, settings]) => { setItems(value); setConfig(settings); setLoaded(true) }).catch(e => setError(String(e)))
  useEffect(() => {
    if (!active) return
    void refresh()
    const dispose = window.electronAPI.assistantRoutines.onChanged(() => { void refresh() })
    const disposeConfig = window.electronAPI.onConfigChanged(setConfig)
    const timer = setInterval(() => { void refresh() }, 15000)
    return () => { dispose(); disposeConfig(); clearInterval(timer) }
  }, [active])
  const act = async (action: () => Promise<AssistantRoutine[]>) => {
    setBusy(true); setError('')
    try { setItems(await action()); setDraft(null); setEditing(undefined); setRemoving(undefined) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const toggleDuty = async (key: AssistantDutyKey) => {
    if (!config) return
    setBusy(true); setError('')
    try { setConfig(await window.electronAPI.db.saveConfig({ [key]: !config[key] })) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return <section className="assistant-routines" aria-label="ChouYu 的助手任务">
    <div className="assistant-routines-heading"><h3>ChouYu 的助手任务</h3><button type="button" disabled={busy || !!draft || !loaded} onClick={() => { setEditing(undefined); setDraft(fresh()) }}>添加安排</button></div>
    <p>我的日常陪伴和定时安排都在这里。问候、提醒和总结会由我发到聊天。</p>
    <details className="assistant-routines-help"><summary>执行规则</summary><p>定时安排按电脑本地时间执行，应用退出期间错过的定时安排会在重新打开后合并补执行一次。日常陪伴按各自条件触发。联系人总结使用你的 AI 模型。</p></details>
    {error && <div role="alert">{error} <button type="button" disabled={busy} onClick={() => void refresh()}>刷新</button></div>}
    {!loaded && !error && <p role="status">正在读取安排…</p>}
    {config && ASSISTANT_DUTIES.map(duty => <div className="assistant-duty" data-assistant-duty={duty.key} key={duty.key}>
      <div className="assistant-routines-heading"><strong>{duty.title}</strong><span>{config[duty.key] ? '已启用' : '已暂停'}</span></div>
      <details className="assistant-duty-rule"><summary>{config[duty.key] ? duty.waiting : '查看触发规则'}</summary><p>{duty.rule}</p></details>
      <button type="button" disabled={busy} aria-label={`${config[duty.key] ? '暂停' : '启用'}${duty.title}`} onClick={() => void toggleDuty(duty.key)}>{config[duty.key] ? '暂停' : '启用'}</button>
    </div>)}
    {loaded && !items.some(item => item.kind === 'contact-summary') && <div className="assistant-duty" data-morning-summary="pending">
      <div className="assistant-routines-heading"><strong>联系人晨间总结</strong><span>待设置时间</span></div>
      <p>每天检查各联系人的真实进展、遇到的问题和等待你答复的事项，再向你汇报。</p>
      <p className="assistant-routines-help">尚未启用；设置时间并保存后执行。</p>
      <button type="button" disabled={busy || !!draft} onClick={() => { setEditing(undefined); setDraft(fresh()) }}>设置时间并启用</button>
    </div>}
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
