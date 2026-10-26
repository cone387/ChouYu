import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import type { TaskRecord, TaskSelectField } from '../../../../shared/tasks'
import type { TaskDraft as Draft } from './TaskEditorDialog'
import type useTaskViewPreferences from './useTaskViewPreferences'
import { assignTaskToGroup } from './taskViewPreferences'
import { saveTaskDraft } from './taskDraftSubmission'
import type { TaskSelection as Selection } from './taskData'
interface Options {
  active: boolean
  preferences: ReturnType<typeof useTaskViewPreferences>
  menusRef: RefObject<HTMLDivElement>
  fields: TaskSelectField[]
  projectBusy: boolean
  selection: Selection
  effectiveStatus: 'open' | 'done' | 'all'
  matchesKeywordAndFilter(task: TaskRecord): boolean
  matchesSelection(task: TaskRecord, selection: Selection): boolean
  reload(): void
  onError(message: string): void
  onNotice(message: string): void
}
export function useTaskDrafts({ active, preferences, menusRef, fields, projectBusy, selection, effectiveStatus,
  matchesKeywordAndFilter, matchesSelection, reload, onError, onNotice }: Options) {
  const customGroups = preferences.value.customGroups
  const [draft, updateDraft] = useState<Draft | null>(null)
  const draftRevision = useRef(0)
  const taskOpenerRef = useRef<HTMLElement | null>(null)
  const restoreTaskFocusRef = useRef(false)
  const setDraft: typeof updateDraft = value => {
    draftRevision.current++
    if (!draft && value !== null) {
      const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
      taskOpenerRef.current = opener
      // Capture keyboard focus before the editor autofocuses its title input.
      restoreTaskFocusRef.current = opener?.matches(':focus-visible') ?? false
    }
    updateDraft(value && typeof value !== 'function' && value.displayGroupId === undefined
      ? { ...value, displayGroupId: customGroups.find(group => group.taskIds.includes(value.id))?.id ?? '' } : value)
  }
  const [busy, setBusy] = useState(false)
  const taskDialogRef = useRef<HTMLDivElement>(null)
  const draftOpen = draft !== null
  const activeRef = useRef(active)
  activeRef.current = active
  useEffect(() => {
    if (!draftOpen || !active) return
    const previous = taskOpenerRef.current
    const restoreFocus = restoreTaskFocusRef.current
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || document.querySelector('dialog:modal')) return
      const controls = Array.from(taskDialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea, summary') ?? []).filter(element => element.getClientRects().length > 0)
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', trap)
    return () => {
      document.removeEventListener('keydown', trap)
      const target = previous?.isConnected ? previous : menusRef.current?.querySelector<HTMLElement>('.tasks-create')
      if (activeRef.current && restoreFocus && target?.getClientRects().length && !document.querySelector('dialog:modal')) target.focus()
    }
  }, [draftOpen, active])

  const submitDraft = (event: FormEvent) => {
    event.preventDefault()
    if (!draft || busy || projectBusy) return
    setBusy(true); onError('')
    const revision = draftRevision.current
    const savingDraft = draft
    void saveTaskDraft(savingDraft, fields, window.electronAPI.tasks)
      .then(saved => {
        if (draft.displayGroupId !== undefined) preferences.update(selection, current => ({ ...current, customGroups: assignTaskToGroup(current.customGroups, saved.id, draft.displayGroupId!) }))
        if (revision !== draftRevision.current) { reload(); return }
        setDraft(null)
        const hidden = !matchesKeywordAndFilter(saved) || (saved.status === 'open'
          ? effectiveStatus === 'done' || selection === 'done' || !matchesSelection(saved, selection)
          : effectiveStatus === 'open' || (selection !== 'done' && !matchesSelection(saved, selection)))
        onNotice(hidden ? '该任务不符合当前视图或筛选条件，暂不在此显示。' : '')
        reload()
      })
      .catch(reason => { if (revision === draftRevision.current) onError(String(reason)) })
      .finally(() => setBusy(false))
  }

  return { draft, setDraft, busy, setBusy, taskDialogRef, submitDraft }
}
