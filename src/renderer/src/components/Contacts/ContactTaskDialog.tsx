import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AgentTopic, AgentOverview } from '../../../../shared/agents'
import { DEFAULT_CHARACTER_ID } from '../../../../shared/characters'
import type { AssistantRoutine } from '../../../../shared/assistant-routines'

export default function ContactTaskDialog({ characterId, task, editTask, readOnly = false, deletion, routine, initialDescription = '', onRoutineDone, onClose, onAction, onDone }: {
  characterId: string; task?: AgentTopic; editTask?: AgentTopic; readOnly?: boolean; onClose: () => void
  routine?: AssistantRoutine; initialDescription?: string; onRoutineDone?: (routine: AssistantRoutine) => void
  deletion?: { title: string; description: string; execute: () => Promise<void> }
  onAction: (action: () => Promise<unknown>) => Promise<void>
  onDone: (data: AgentOverview) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [description, setDescription] = useState(initialDescription)
  const [conversation, setConversation] = useState('')
  const [context, setContext] = useState<{ request: string; question: string }[]>([])
  const [question, setQuestion] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const deleting = Boolean(task || deletion)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const element = dialog.current
    element?.showModal()
    return () => { element?.close(); requestAnimationFrame(() => { if (previous?.isConnected) previous.focus({ preventScroll: true }) }) }
  }, [])
  return createPortal(<dialog ref={dialog} className="contact-task-dialog" data-interactive aria-labelledby={titleId} onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation() }} onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!pending) onClose() }}>
    <form onSubmit={event => {
      event.preventDefault(); if (pending || readOnly) return
      setPending(true); setError('')
      void onAction(async () => {
        try {
          if (deletion) { await deletion.execute(); onClose(); return }
          if (editTask) {
            const data = await window.electronAPI.agents.editTopic(characterId, editTask.id, editTask.revision, { title: editTask.title, goal: description.trim(), constraints: '' }, '用户更新任务描述')
            onDone(data); onClose(); return
          }
          if (!task && characterId === DEFAULT_CHARACTER_ID) {
            const request = `${conversation}${description.trim()}`
            const result = await window.electronAPI.assistantRoutines.request(request, routine?.id, routine?.revision)
            if (result.kind === 'question') {
              setContext(previous => [...previous, { request: description.trim(), question: result.question }])
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
      <h3 id={titleId}>{deleting ? '删除任务' : readOnly ? '任务描述' : routine || editTask ? '修改任务' : '新建任务'}</h3>
      {deleting ? <p>确定删除「{task?.title ?? deletion?.title}」？{deletion?.description ?? '任务会停止执行，成果、运行和互动记录将一并删除，聊天消息保留。此操作无法撤销。'}</p> : <>
        {context.length > 0 && <section className="task-request-context" aria-label="已交代的任务"><strong>已交代的任务</strong>{context.map((turn, index) => <div key={index}><p>{index ? '你的补充：' : ''}{turn.request}</p>{index < context.length - 1 && <p className="agent-caption">{turn.question}</p>}</div>)}</section>}
        {question && <p role="status">{question}</p>}
        <label htmlFor={`${titleId}-description`}>{question ? '补充说明' : '任务描述'}</label>
        <textarea id={`${titleId}-description`} data-task-description autoFocus rows={question ? 3 : 6} maxLength={2000} readOnly={readOnly} required value={description} disabled={pending} onChange={event => setDescription(event.target.value)} placeholder={question ? "补充这个问题即可……" : "说说你想完成什么……"} />
        <p className="agent-caption">{readOnly ? '这是内置陪伴任务，按系统规则触发，可在任务页启用或暂停。' : editTask ? '直接描述任务目标和要求。保存会停止当前执行，已有成果和历史保留。' : question ? '保留前面的任务要求，只补充缺少的信息。' : characterId === DEFAULT_CHARACTER_ID ? '直接描述要做什么、什么时候做。例如：每个工作日早上八点半，汇总各联系人的进展和需要我回复的事情。缺少必要信息时我会继续问你。' : 'AI 会接下任务。忙碌或今日额度不足时先排队，当前任务完成或等待回复时接续；缺少必要信息会发消息向你确认。'}</p>
      </>}
      {error && <p role="alert" className="agent-error">{error}</p>}
      <footer><button type="button" autoFocus={deleting} disabled={pending} onClick={onClose}>{readOnly ? '关闭' : '取消'}</button>{!readOnly && <button data-task-dialog-submit type="submit" className={deleting ? 'danger' : 'primary'} disabled={pending || (!deleting && !description.trim())}>{pending ? '处理中…' : deleting ? '删除任务' : editTask ? '保存' : '交给 AI'}</button>}</footer>
    </form>
  </dialog>, document.body)
}
