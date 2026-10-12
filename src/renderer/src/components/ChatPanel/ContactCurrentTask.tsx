import { useEffect, useRef, useState } from 'react'
import type { AgentFocusRequest, AgentOverview } from '../../../../shared/agents'
import { contactTaskExecution, currentTaskChoices, selectCurrentTask } from '../Contacts/contactTaskExecution'
import ContactTaskRunButton from '../Contacts/ContactTaskRunButton'
import ContactTaskStatusIcon from './ContactTaskStatusIcon'

export default function ContactCurrentTask({ characterId, onOpen }: { characterId: string; onOpen: (focus: AgentFocusRequest) => void }) {
  const [data, setData] = useState<AgentOverview>()
  const [selected, setSelected] = useState('')
  const [readError, setReadError] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const submitting = useRef(false), refreshRef = useRef<() => Promise<void>>(async () => {})
  useEffect(() => {
    let alive = true, sequence = 0
    let pending: ReturnType<typeof setTimeout> | undefined
    setData(undefined); setSelected(''); setError(''); setReadError('')
    const refresh = async () => {
      const ticket = ++sequence
      try {
        const next = await window.electronAPI.agents.get(characterId)
        if (alive && ticket === sequence) { setData(next); setReadError('') }
      } catch (e) { if (alive && ticket === sequence) setReadError(e instanceof Error ? e.message : '任务状态读取失败') }
    }
    refreshRef.current = refresh
    void refresh()
    const off = window.electronAPI.agents.onChanged(id => {
      if (id !== characterId) return
      clearTimeout(pending); pending = setTimeout(() => { void refresh() }, 150)
    })
    const timer = setInterval(() => { void refresh() }, 30000)
    return () => { alive = false; off(); clearTimeout(pending); clearInterval(timer) }
  }, [characterId])
  const choices = data ? currentTaskChoices(data) : []
  const current = selectCurrentTask(choices, selected)
  useEffect(() => { if (!selected && current) setSelected(current.topic.id) }, [selected, current?.topic.id])
  const open = () => {
    if (current) onOpen({ topicId: current.topic.id, runId: current.run?.id ?? current.latestRun?.id ?? '', kind: current.action === 'reply' ? 'question' : 'progress', tab: current.action === 'inspect' ? 'history' : 'work', nonce: Date.now() })
  }
  const act = async () => {
    if (!current || submitting.current || readError) return
    const { topic, action } = current
    if (action === 'reply' || action === 'inspect') { open(); return }
    submitting.current = true; setBusy(true); setError(''); setSelected(topic.id)
    try {
      // Re-read before mutating: a completed round must not turn a stale pause into a resume.
      const latest = await window.electronAPI.agents.get(characterId)
      const target = latest.topics.find(item => item.id === topic.id)
      if (!target || target.revision !== topic.revision || contactTaskExecution(latest, target).action !== action) throw new Error('任务状态已变化，请核对最新状态后再操作。')
      if (action === 'pause') await window.electronAPI.agents.topicStatus(characterId, topic.id, topic.revision, 'paused', '用户在聊天快捷工具栏暂停任务')
      else if (action === 'continue') await window.electronAPI.agents.continueTopic(characterId, topic.id, topic.revision, '用户在聊天快捷工具栏继续任务')
    } catch (e) { setError(e instanceof Error ? e.message : '操作失败，请重试') }
    finally { await refreshRef.current(); submitting.current = false; setBusy(false) }
  }
  if (!choices.length && !readError && !error) return null
  return <div className="contact-current-task" data-contact-current-task={characterId} aria-busy={busy}>
    <div className="contact-current-task-controls">
      {current && <ContactTaskStatusIcon state={readError ? { code: 'unavailable', label: '状态读取失败', description: '重新读取后确认任务状态。' } : current.state} />}
      {choices.length > 1 || selected && !current ? <select aria-label="当前操作的任务" title={current ? `${current.topic.title} · ${current.state.label}：${current.state.description}` : '原任务已结束或删除，请选择任务'} value={current?.topic.id ?? ''} disabled={busy || Boolean(readError)}
        onChange={e => { setSelected(e.target.value); setError('') }}>
        {!current && <option value="" disabled>原任务已结束或删除，请选择任务</option>}
        {choices.map(item => <option key={item.topic.id} value={item.topic.id}>{item.topic.title} · {item.state.label}</option>)}
      </select> : current && <button type="button" className="contact-current-task-name" title={`${current.topic.title} · ${current.state.label}：${current.state.description}`} onClick={() => onOpen({ topicId: current.topic.id, runId: current.run?.id ?? current.latestRun?.id ?? '', kind: 'progress', tab: 'work', nonce: Date.now() })} disabled={busy}>{current.topic.title}</button>}
      {current && <>
        {current.action === 'reply' || current.action === 'inspect' ? <button type="button" onClick={open} disabled={busy || Boolean(readError)}>{current.action === 'reply' ? '回复问题' : '处理样式失败'}</button>
          : <ContactTaskRunButton toolbar pause={current.action === 'pause'} disabled={busy || Boolean(readError)} title={`${current.action === 'pause' ? '暂停' : '继续'}「${current.topic.title}」`}
            label={busy ? '处理中…' : current.action === 'pause' ? '暂停' : current.state.code === 'failed' ? '重试' : '继续'} onClick={() => void act()} />}
      </>}
    </div>
    {(readError || error) && <div className="contact-current-task-error" role="alert">{readError || error}{readError && <button type="button" onClick={() => void refreshRef.current()}>重新读取</button>}</div>}
  </div>
}
