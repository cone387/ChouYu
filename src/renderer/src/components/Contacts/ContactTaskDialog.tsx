import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AgentTopic, AgentOverview } from '../../../../shared/agents'
import { DEFAULT_CHARACTER_ID } from '../../../../shared/characters'
import type { AssistantRoutine } from '../../../../shared/assistant-routines'

export default function ContactTaskDialog({ characterId, task, routine, initialDescription = '', onRoutineDone, onClose, onAction, onDone }: {
  characterId: string; task?: AgentTopic; onClose: () => void
  routine?: AssistantRoutine; initialDescription?: string; onRoutineDone?: (routine: AssistantRoutine) => void
  onAction: (action: () => Promise<unknown>) => Promise<void>
  onDone: (data: AgentOverview) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [description, setDescription] = useState(initialDescription)
  const [conversation, setConversation] = useState('')
  const [question, setQuestion] = useState('')
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
          if (!task && characterId === DEFAULT_CHARACTER_ID) {
            const request = `${conversation}${description.trim()}`
            const result = await window.electronAPI.assistantRoutines.request(request, routine?.id, routine?.revision)
            if (result.kind === 'question') {
              setConversation(`${request}\n联系人追问：${result.question}\n用户补充：`)
              setQuestion(result.question); setDescription('')
              return
            }
            if (result.kind === 'routine') { onRoutineDone?.(result.routine); onClose(); return }
            const data = await window.electronAPI.agents.assignTopic(characterId, result.description)
            onDone(data); onClose(); return
          }
          const data = task
            ? await window.electronAPI.agents.deleteTopic(characterId, task.id, task.revision)
            : await window.electronAPI.agents.assignTopic(characterId, description.trim())
          onDone(data); onClose()
        } catch (error) { setError(error instanceof Error ? error.message : '操作失败，请重试。'); throw error }
      }).finally(() => setPending(false))
    }}>
      <h3 id={titleId}>{task ? '删除任务' : routine ? '修改任务' : '新建任务'}</h3>
      {task ? <p>确定删除「{task.title}」？任务会停止执行，成果、运行和互动记录将一并删除，聊天消息保留。此操作无法撤销。</p> : <>
        {question && <p role="status">{question}</p>}
        <label htmlFor={`${titleId}-description`}>{question ? '补充说明' : routine ? '告诉我怎么调整' : '任务描述'}</label>
        <textarea id={`${titleId}-description`} data-task-description autoFocus rows={6} maxLength={2000} required value={description} disabled={pending} onChange={event => setDescription(event.target.value)} placeholder="说说你想完成什么……" />
        <p className="agent-caption">{characterId === DEFAULT_CHARACTER_ID ? '直接描述要做什么、什么时候做。例如：每个工作日早上八点半，汇总各联系人的进展和需要我回复的事情。缺少必要信息时我会继续问你。' : 'AI 会接下任务。忙碌或今日额度不足时先排队，当前任务完成或等待回复时接续；缺少必要信息会发消息向你确认。'}</p>
      </>}
      {error && <p role="alert" className="agent-error">{error}</p>}
      <footer><button type="button" autoFocus={Boolean(task)} disabled={pending} onClick={onClose}>取消</button><button data-task-dialog-submit type="submit" className={task ? 'danger' : 'primary'} disabled={pending || (!task && !description.trim())}>{pending ? '处理中…' : task ? '删除任务' : '交给 AI'}</button></footer>
    </form>
  </dialog>, document.body)
}
