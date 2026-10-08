import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AgentTopic, AgentOverview } from '../../../../shared/agents'
import { DEFAULT_CHARACTER_ID } from '../../../../shared/characters'
import type { AssistantRoutine } from '../../../../shared/assistant-routines'
import type { AssistantDutyKey } from '../../../../shared/assistant-duties'
import type { ContactTaskTarget } from '../../../../shared/contact-task-gateway'

export default function ContactTaskDialog({ characterId, editTask, deletion, routine, duty, initialDescription = '', onRoutineDone, onDutyDone, onClose, onAction, onDone }: {
  characterId: string; editTask?: AgentTopic; onClose: () => void
  routine?: AssistantRoutine; initialDescription?: string; onRoutineDone?: (routine: AssistantRoutine) => void
  duty?: { key: AssistantDutyKey; title: string; values: [string, number][] }; onDutyDone?: () => void
  deletion?: { title: string; description: string; execute: () => Promise<void> }
  onAction: (action: () => Promise<unknown>) => Promise<void>
  onDone: (data: AgentOverview) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [description, setDescription] = useState(initialDescription)
  const [context, setContext] = useState<{ request: string; question: string }[]>([])
  const [question, setQuestion] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [savedNotice, setSavedNotice] = useState('')
  const [pendingOverview, setPendingOverview] = useState<AgentOverview | null>(null)
  const deleting = Boolean(deletion)
  const target: ContactTaskTarget = editTask ? { kind: 'edit-work', characterId, topicId: editTask.id, topicRevision: editTask.revision }
    : routine ? { kind: 'edit-routine', characterId, routineId: routine.id, routineRevision: routine.revision }
    : duty ? { kind: 'edit-duty', characterId, dutyKey: duty.key }
    : { kind: 'create', characterId }
  const targetKey = editTask ? `edit-work:${characterId}:${editTask.id}` : routine ? `edit-routine:${routine.id}` : duty ? `edit-duty:${duty.key}` : `create:${characterId}`
  useEffect(() => {
    let active = true
    void window.electronAPI.contactTask.drafts().then(drafts => {
      if (!active) return
      const draft = drafts.find(item => item.targetKey === targetKey)
      if (!draft?.turns.length) return
      setContext(draft.turns.slice(0, -1).flatMap((turn, index) => turn.role === 'user' ? [{ request: turn.text, question: draft.turns[index + 1]?.role === 'assistant' ? draft.turns[index + 1].text : '' }] : []).filter(turn => turn.request))
      const last = draft.turns.at(-1)
      if (last?.role === 'assistant') { setQuestion(last.text); setDescription('') }
    }).catch(() => { /* 草稿恢复失败按空白开始 */ })
    return () => { active = false }
  }, [targetKey])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const element = dialog.current
    element?.showModal()
    return () => { element?.close(); requestAnimationFrame(() => { if (previous?.isConnected) previous.focus({ preventScroll: true }) }) }
  }, [])
  return createPortal(<dialog ref={dialog} className="contact-task-dialog" data-interactive aria-labelledby={titleId} onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation() }} onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!pending) onClose() }}>
    <form onSubmit={event => {
      event.preventDefault(); if (pending) return
      setPending(true); setError('')
      void onAction(async () => {
        try {
          if (deletion) { await deletion.execute(); onClose(); return }
          const result = await window.electronAPI.contactTask.request(target, description.trim())
          if (result.kind === 'question') {
            setContext(previous => [...previous, { request: description.trim(), question: result.question }])
            setQuestion(result.question); setDescription('')
            return
          }
          if (result.kind === 'routine') { onRoutineDone?.(result.routine); onClose(); return }
          if (result.kind === 'duty') { onDutyDone?.(); onClose(); return }
          if (result.kind === 'work-edited' && (result.budgetError || result.statusError)) {
            setSavedNotice([result.budgetError ? `预算未调整：${result.budgetError}` : '', result.statusError ? `状态未调整：${result.statusError}` : ''].filter(Boolean).join('；'))
            setPendingOverview(result.overview)
            return
          }
          onDone(result.overview); onClose()
        } catch (error) { setError(error instanceof Error ? error.message : '操作失败，请重试。'); throw error }
      }).finally(() => setPending(false))
    }}>
      <h3 id={titleId}>{deleting ? '删除任务' : editTask || routine || duty ? '修改任务' : '新建任务'}</h3>
      {savedNotice ? <p role="status">任务已保存。{savedNotice}</p> : deleting ? <p>确定删除「{deletion?.title}」？{deletion?.description ?? '任务会停止执行，成果、运行和互动记录将一并删除，聊天消息保留。此操作无法撤销。'}</p> : <>
        {context.length > 0 && <section className="task-request-context" aria-label="已交代的任务"><strong>已交代的任务</strong>{context.map((turn, index) => <div key={index}><p>{index ? '你的补充：' : ''}{turn.request}</p>{index < context.length - 1 && <p className="agent-caption">{turn.question}</p>}</div>)}</section>}
        {question && <p role="status">{question}</p>}
        <label htmlFor={`${titleId}-description`}>{question ? '补充说明' : '任务描述'}</label>
        <textarea id={`${titleId}-description`} data-task-description autoFocus rows={question ? 3 : 6} maxLength={2000} required value={description} disabled={pending} onChange={event => setDescription(event.target.value)} placeholder={question ? "补充这个问题即可……" : "说说你想完成什么……"} />
        <p className="agent-caption">{duty ? `${duty.values.map(([label, value]) => `${label}：${value} 分钟`).join('；')}。直接说要改成多少。${duty.key === 'proactiveGreeting' ? '每日问好没有可调参数，只能启用或暂停。' : ''}` : editTask ? '直接描述任务目标和要求。保存会停止当前执行，已有成果和历史保留。' : question ? '保留前面的任务要求，只补充缺少的信息。' : characterId === DEFAULT_CHARACTER_ID ? '直接描述要做什么、什么时候做。例如：每个工作日早上八点半，汇总各联系人的进展和需要我回复的事情。缺少必要信息时我会继续问你。' : 'AI 会接下任务。忙碌或今日额度不足时先排队，当前任务完成或等待回复时接续；缺少必要信息会发消息向你确认。'}</p>
      </>}
      {error && <p role="alert" className="agent-error">{error}</p>}
      <footer>{savedNotice ? <button type="button" data-task-dialog-submit className="primary" onClick={() => { onDone(pendingOverview!); onClose() }}>完成</button> : <>
        <button type="button" autoFocus={deleting} disabled={pending} onClick={onClose}>取消</button>
        <button data-task-dialog-submit type="submit" className={deleting ? 'danger' : 'primary'} disabled={pending || (!deleting && !description.trim())}>{pending ? '处理中…' : deleting ? '删除任务' : editTask || duty ? '保存' : '交给 AI'}</button>
      </>}</footer>
    </form>
  </dialog>, document.body)
}
