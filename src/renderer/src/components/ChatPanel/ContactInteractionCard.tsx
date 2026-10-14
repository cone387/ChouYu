import { navigateContact } from '../Contacts/contactNavigation'
import { useContactVisible } from '../Contacts/useContactVisible'
import { useEffect, useRef, useState } from 'react'
import type { ContactBudgetKey, ContactInteraction } from '../../../../shared/contact-interactions'
import './ContactInteractionCard.css'
import ContactFailureRemedy from './ContactFailureRemedy'

export default function ContactInteractionCard({ characterId, interactionId, fallback, onOpen, showOwner = false, active = true }: {
  characterId: string; interactionId: string; fallback: string; showOwner?: boolean; onOpen?: () => void; active?: boolean
}) {
  const visible = useContactVisible(active)
  const [view, setView] = useState<ContactInteraction | null>(null)
  const [answer, setAnswer] = useState('')
  const [limits, setLimits] = useState<Partial<Record<ContactBudgetKey, string>>>({})
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [readError, setReadError] = useState('')
  const refreshRef = useRef<() => Promise<void>>(async () => {})
  const submitting = useRef(false)
  const generation = useRef(0)
  const hydrated = useRef('')
  useEffect(() => { setView(null); setAnswer(''); setLimits({}); setError(''); setReadError('') }, [characterId, interactionId])
  useEffect(() => {
    if (!visible) return
    let disposed = false
    const refresh = async () => {
      const ticket = ++generation.current
      try {
        const next = await window.electronAPI.agents.getInteraction(characterId, interactionId)
        if (disposed || ticket !== generation.current) return
        setView(next); setReadError('')
        if (hydrated.current !== interactionId) {
          hydrated.current = interactionId
          if (next.kind === 'action' && next.status === 'failed' && next.request.input?.argument !== 'credential' && next.response?.text) setAnswer(next.response.text)
        }
        setLimits(previous => Object.fromEntries(next.budgets.map(field => [field.key, previous[field.key] ?? String(field.limit)])))
      } catch (e) { if (!disposed && ticket === generation.current) setReadError(e instanceof Error ? e.message : '暂时无法读取处理状态') }
    }
    refreshRef.current = refresh
    void refresh()
    const off = window.electronAPI.agents.onChanged(id => { if (id === characterId && !submitting.current) void refresh() })
    const timer = window.setInterval(() => { if (!submitting.current && document.visibilityState === 'visible') void refresh() }, 30000)
    return () => { disposed = true; off(); window.clearInterval(timer) }
  }, [characterId, interactionId, visible])
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!view || submitting.current || view.status !== 'pending') return
    submitting.current = true; setBusy(true); setError('')
    generation.current++
    try {
      const result = await window.electronAPI.agents.submitInteraction(characterId, interactionId, {
        version: view.version, ...(view.kind === 'question' ? { answer } : {}),
        limits: Object.fromEntries(view.budgets.map(field => [field.key, Number(limits[field.key])]))
      })
      setView(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败，请重试')
      await refreshRef.current()
    } finally { submitting.current = false; setBusy(false) }
  }
  const submitAction = async (actionId?: string, acknowledge = false) => {
    if (!view || view.kind !== 'action' || submitting.current || !['pending', 'failed'].includes(view.status)) return
    submitting.current = true; setBusy(true); setError(''); generation.current++
    try {
      const result = await window.electronAPI.agents.submitInteraction(characterId, interactionId, { version: view.version,
        ...(acknowledge ? { acknowledge: true } : actionId ? { actionId, ...(view.request.input ? (view.request.input.argument === 'credential' ? { credential: answer } : { text: answer }) : {}) } : { reject: true }) })
      setView(result)
      if (result.status === 'resolved') setAnswer('')
    } catch (e) { setError(e instanceof Error ? e.message : '提交失败，请重试'); await refreshRef.current() }
    finally { submitting.current = false; setBusy(false) }
  }
  const openTask = onOpen ?? (view?.topicId ? () => { void navigateContact({ kind: 'task', characterId, topicId: view.topicId! }).catch(e => setError(e.message)) } : undefined)
  const currentTitles: Partial<Record<NonNullable<ContactInteraction['currentState']>, string>> = { queued: '已重新排队', running: '正在重新尝试', completed: '后续工作已完成', waiting: '现在需要你的回复', paused: '任务已暂停', deleted: '任务已删除', failed: '后续尝试仍受阻' }
  const title = view && view.status !== 'pending' ? (view.currentState && currentTitles[view.currentState]) || (view.status === 'resolved' ? '已处理' : '处理状态已更新')
    : view?.kind === 'question' ? '需要你的回复' : view?.kind === 'budget' ? '当前额度不足以继续' : view?.failure?.title || '这次尝试中断'
  return <section className="contact-interaction" data-contact-interaction={interactionId} data-contact-owner={characterId} data-interaction-topic={view?.topicId} aria-busy={busy}>
    {view?.kind === 'action' ? <>
      {showOwner && view.characterName && <div className="contact-interaction-task">{view.characterName}</div>}
      <strong className="contact-interaction-title">{view.request.title}</strong>
      <p className="contact-interaction-question">{view.request.body}</p>
      {view.result && <p role="status" className="contact-interaction-result">{view.result}</p>}
      {view.status === 'failed' && view.retryable === false && <button type="button" disabled={busy} onClick={() => void submitAction(undefined, true)}>我已核对当前状态，关闭此事项</button>}
      {['pending', 'failed'].includes(view.status) && <>
        {view.request.input && <label className="contact-interaction-field"><span>{view.request.input.label}</span>{view.request.input.argument === 'credential'
          ? <><input type="password" autoComplete="off" value={answer} onChange={e => setAnswer(e.target.value)} maxLength={view.request.input.maxLength} required disabled={busy} /><span className="contact-interaction-usage">仅保存到此联系人的凭据设置，不发送给模型。</span></>
          : <textarea value={answer} onChange={e => setAnswer(e.target.value)} maxLength={view.request.input.maxLength} required={view.request.input.required} rows={3} disabled={busy} readOnly={view.retryable === false} />}</label>}
        {view.retryable !== false && <div className="contact-interaction-actions">{view.request.actions.map(action => <button key={action.id} type="button" className="primary" disabled={busy || Boolean(view.request.input?.required && !answer.trim())} onClick={() => void submitAction(action.id)}>{busy ? '正在处理…' : action.label}</button>)}
          <button type="button" disabled={busy} onClick={() => void submitAction()}>拒绝</button>
        </div>}
      </>}
    </> : view ? <>
      {showOwner && view.characterName && <div className="contact-interaction-task">{view.characterName}</div>}
      <strong className="contact-interaction-title">{title}</strong>
      <div className="contact-interaction-task">{view.topicTitle}</div>
      {view.kind === 'question' ? <p className="contact-interaction-question">{view.status === 'pending' ? '' : '此前的问题：'}{view.question}</p> : <p>{view.kind === 'budget' ? (view.status === 'pending' ? '下方列出实际不足的额度和继续所需用量。调整后才会继续，不会自动提高上限。' : '此前因额度不足暂停了推进。当前处理结果见下方。') : `${view.status === 'pending' ? '' : '此前中断的原因：'}${view.failure?.message || fallback}`}</p>}
      {view.impact && <p className="contact-interaction-usage">{view.impact}</p>}
      {view.failureDetail && <details className="contact-interaction-diagnostic"><summary>技术诊断</summary><p>{view.failureDetail}</p></details>}
      {view.status === 'pending' && view.recoveryMessage && <p className="contact-interaction-recovery" role="status">{view.recoveryMessage}</p>}
      {view.status === 'pending' && view.kind === 'retry' && <ContactFailureRemedy view={view} />}
      {view.status === 'pending' ? <form onSubmit={submit} noValidate>
        {view.budgets.map(field => <label className="contact-interaction-field" key={field.key}>
          <span>{field.label}</span>
          <span className="contact-interaction-usage">已用 {field.used.toLocaleString()} / {field.limit.toLocaleString()} {field.unit} · 继续至少需要 {field.needed.toLocaleString()} {field.unit}</span>
          <span className="contact-interaction-input"><input type="number" step="1" min={field.used + field.needed} max={field.max} required
            aria-label={field.label} value={limits[field.key] ?? ''} disabled={busy}
            onChange={e => setLimits(previous => ({ ...previous, [field.key]: e.target.value }))} /><span>{field.unit}</span></span>
        </label>)}
        {view.kind === 'question' && <label className="contact-interaction-field"><span>你的回复</span>
          <textarea value={answer} onChange={e => setAnswer(e.target.value)} required maxLength={2000} rows={3} disabled={busy} placeholder="直接回复即可" />
        </label>}
        <div className="contact-interaction-actions">
          <button type="submit" className="primary" disabled={busy || view.kind === 'question' && !answer.trim()}>{busy ? '正在处理…' : view.kind === 'question' ? '回复并继续' : view.kind === 'budget' || view.budgets.length ? '调整并继续' : view.failure?.action || '重试本任务'}</button>
          {view.failure?.settings && <button type="button" disabled={busy} onClick={() => void navigateContact(view.failure?.settingsTarget
            ? { kind: 'contact-settings', characterId, tab: view.failure.settingsTarget === 'skills' ? 'skills' : 'settings' }
            : { kind: 'settings' }).catch(e => setError(e.message))}>{view.failure.settingsTarget === 'skills' ? '检查技能与运行环境' : view.failure.settingsTarget === 'work' ? '联系人权限设置' : view.failure.kind === 'permission' ? '工具设置' : '模型服务设置'}</button>}
          {openTask && <button type="button" onClick={openTask} disabled={busy}>查看任务</button>}
        </div>
      </form> : <div className="contact-interaction-result" role="status">{view.result || '此事项已处理'}{openTask && <div className="contact-interaction-actions"><button type="button" onClick={openTask}>查看任务</button></div>}</div>}
    </> : <><p>{fallback}</p><span role="status">{error || readError ? '处理状态暂不可用' : '正在读取处理状态…'}</span>{openTask && <button type="button" onClick={openTask}>查看任务</button>}</>}
    {(error || readError) && <div className="contact-interaction-error" role="alert">{error || readError}<button type="button" disabled={busy} onClick={() => { setError(''); void refreshRef.current() }}>重新读取</button></div>}
  </section>
}
