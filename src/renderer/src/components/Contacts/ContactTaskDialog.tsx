import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AgentTopic, AgentOverview } from '../../../../shared/agents'

export default function ContactTaskDialog({ characterId, task, onClose, onAction, onDone }: {
  characterId: string; task?: AgentTopic; onClose: () => void
  onAction: (action: () => Promise<unknown>) => Promise<void>
  onDone: (data: AgentOverview) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [description, setDescription] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    return () => { dialog.current?.close(); if (previous?.isConnected) previous.focus() }
  }, [])
  return createPortal(<dialog ref={dialog} className="contact-task-dialog" data-interactive aria-labelledby={titleId} onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!pending) onClose() }}>
    <form onSubmit={event => {
      event.preventDefault(); if (pending) return
      setPending(true); setError('')
      void onAction(async () => {
        try {
          const data = task
            ? await window.electronAPI.agents.deleteTopic(characterId, task.id, task.revision)
            : await window.electronAPI.agents.assignTopic(characterId, description.trim())
          onDone(data); onClose()
        } catch (error) { setError(error instanceof Error ? error.message : '操作失败，请重试。'); throw error }
      }).finally(() => setPending(false))
    }}>
      <h3 id={titleId}>{task ? '删除任务' : '新建任务'}</h3>
      {task ? <p>确定删除「{task.title}」？任务会停止执行，成果、运行和互动记录将一并删除，聊天消息保留。此操作无法撤销。</p> : <>
        <label htmlFor={`${titleId}-description`}>任务描述</label>
        <textarea id={`${titleId}-description`} data-task-description autoFocus rows={6} maxLength={2000} required value={description} disabled={pending} onChange={event => setDescription(event.target.value)} placeholder="说说你想完成什么……" />
        <p className="agent-caption">AI 会梳理任务并开始执行，有不明确的地方会发消息向你确认。</p>
      </>}
      {error && <p role="alert" className="agent-error">{error}</p>}
      <footer><button type="button" autoFocus={Boolean(task)} disabled={pending} onClick={onClose}>取消</button><button data-task-dialog-submit type="submit" className={task ? 'danger' : 'primary'} disabled={pending || (!task && !description.trim())}>{pending ? '处理中…' : task ? '删除任务' : '交给 AI'}</button></footer>
    </form>
  </dialog>, document.body)
}
