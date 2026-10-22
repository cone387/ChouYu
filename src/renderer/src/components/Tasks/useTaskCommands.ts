import { useRef, useState } from 'react'
import type { useConfirm } from '../common/ConfirmProvider'
interface Options {
  reload(): void
  onError(message: string): void
  onNotice(message: string): void
  confirm: ReturnType<typeof useConfirm>
}
/** Single-task commands and the shared mutation lock used by drag moves. */
export function useTaskCommands({ reload, onError, onNotice, confirm }: Options) {
  const actionLock = useRef(false)
  const [actionPending, setActionPending] = useState(false)
  const performAction = async (operation: () => Promise<unknown>) => {
    if (actionLock.current) return
    actionLock.current = true; setActionPending(true); onError(''); onNotice('')
    try { await operation(); reload() }
    catch (reason) { onNotice(''); onError(reason instanceof Error ? reason.message : String(reason)) }
    finally { actionLock.current = false; setActionPending(false) }
  }
  const complete = (id: string) => { void performAction(() => window.electronAPI.tasks.complete(id)) }
  const reopen = (id: string) => { void performAction(() => window.electronAPI.tasks.reopen(id)) }
  const remove = async (id: string) => {
    if (!await confirm({ title: '删除任务', message: '将这个任务移入回收站？之后可以恢复。' })) return
    void performAction(() => window.electronAPI.tasks.remove(id))
  }
  return { actionLock, actionPending, setActionPending, performAction, complete, reopen, remove }
}
