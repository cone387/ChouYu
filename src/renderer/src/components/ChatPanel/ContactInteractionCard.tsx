import { navigateContact } from '../Contacts/contactNavigation'
import { useEffect, useRef, useState } from 'react'
import type { ContactBudgetKey, ContactInteraction } from '../../../../shared/contact-interactions'
import './ContactInteractionCard.css'

export default function ContactInteractionCard({ characterId, interactionId, fallback, onOpen, showOwner = false }: {
  characterId: string; interactionId: string; fallback: string; showOwner?: boolean; onOpen?: () => void
}) {
  const [view, setView] = useState<ContactInteraction | null>(null)
  const [answer, setAnswer] = useState('')
  const [limits, setLimits] = useState<Partial<Record<ContactBudgetKey, string>>>({})
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const refreshRef = useRef<() => Promise<void>>(async () => {})
  const submitting = useRef(false)
  const generation = useRef(0)
  useEffect(() => {
    let disposed = false
    setView(null); setAnswer(''); setLimits({}); setError('')
    const refresh = async () => {
      const ticket = ++generation.current
      try {
        const next = await window.electronAPI.agents.getInteraction(characterId, interactionId)
        if (disposed || ticket !== generation.current) return
        setView(next)
        setLimits(previous => Object.fromEntries(next.budgets.map(field => [field.key, previous[field.key] ?? String(field.limit)])))
      } catch (e) { if (!disposed && ticket === generation.current) setError(e instanceof Error ? e.message : '暂时无法读取处理状态') }
    }
    refreshRef.current = refresh
    void refresh()
    const off = window.electronAPI.agents.onChanged(id => { if (id === characterId && !submitting.current) void refresh() })
    return () => { disposed = true; off() }
  }, [characterId, interactionId])
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
  const openTask = onOpen ?? (view ? () => { void navigateContact({ kind: 'task', characterId, topicId: view.topicId }).catch(e => setError(e.message)) } : undefined)
  const title = view?.kind === 'question' ? '需要你的回复' : view?.kind === 'budget' ? '需要补充额度' : '本次工作未完成'
  return <section className="contact-interaction" data-contact-interaction={interactionId} aria-busy={busy}>
    {view ? <>
      {showOwner && view.characterName && <div className="contact-interaction-task">{view.characterName}</div>}
      <strong className="contact-interaction-title">{title}</strong>
      <div className="contact-interaction-task">{view.topicTitle}</div>
      {view.kind === 'question' ? <p className="contact-interaction-question">{view.question}</p> : <p>{view.kind === 'budget' ? '已有成果保留，当前额度不足以继续。' : view.failure?.message || fallback}</p>}
      {view.status === 'pending' && view.automaticRetryAt && <p className="contact-interaction-usage">最早 {new Date(view.automaticRetryAt).toLocaleString()} 自动尝试继续，仍受工作时间和额度限制。也可以现在重试。</p>}
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
          {view.failure?.settings && <button type="button" disabled={busy} onClick={() => void navigateContact({ kind: 'settings' }).catch(e => setError(e.message))}>模型服务设置</button>}
          {openTask && <button type="button" onClick={openTask} disabled={busy}>查看任务</button>}
        </div>
      </form> : <div className="contact-interaction-result" role="status">{view.result || '此事项已处理'}{openTask && <div className="contact-interaction-actions"><button type="button" onClick={openTask}>查看任务</button></div>}</div>}
    </> : <><p>{fallback}</p><span role="status">{error ? '处理状态暂不可用' : '正在读取处理状态…'}</span>{openTask && <button type="button" onClick={openTask}>查看任务</button>}</>}
    {error && <div className="contact-interaction-error" role="alert">{error}<button type="button" disabled={busy} onClick={() => { setError(''); void refreshRef.current() }}>重新读取</button></div>}
  </section>
}
