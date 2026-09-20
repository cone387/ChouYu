import { useEffect, useState } from 'react'
import type { TaskTrashEntry } from '../../../../shared/tasks'
import { useConfirm } from '../common/ConfirmProvider'
import TaskUtilityDialog from './TaskUtilityDialog'

export default function TaskTrashDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const confirm = useConfirm()
  const [items, setItems] = useState<TaskTrashEntry[]>([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    void window.electronAPI.tasks.trash().then(value => { if (alive) setItems(value) }).catch(reason => { if (alive) setError(String(reason)) }).finally(() => { if (alive) setBusy(false) })
    return () => { alive = false }
  }, [])
  const act = async (entry: TaskTrashEntry, purge: boolean) => {
    if (busy) return
    if (purge && !await confirm({ title: '永久删除', message: `永久删除「${entry.name}」的回收记录？之后将无法恢复。`, confirmLabel: '永久删除' })) return
    setBusy(true); setError('')
    try {
      await window.electronAPI.tasks[purge ? 'purgeTrash' : 'restoreTrash'](entry.id)
      setItems(await window.electronAPI.tasks.trash()); onChanged()
    } catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  return <TaskUtilityDialog title="任务回收站" busy={busy} onClose={onClose}>
    <p className="tasks-view-description">恢复时保留任务及其清单归属。同名清单会加上“恢复”后缀；已错过的提醒不会重新弹出。</p>
    {error && <p role="alert" className="tasks-error">{error}</p>}
    {busy && <p role="status">正在处理…</p>}
    {!busy && !items.length && <p>回收站为空。</p>}
    <ul className="tasks-recovery-list">{items.map(entry => <li key={entry.id}>
      <div><strong>{entry.name}</strong><p>{entry.kind === 'task' ? '任务' : entry.kind === 'project' ? '清单' : '分组'} · {entry.taskCount} 项任务 · {new Date(entry.deletedAt).toLocaleString()}</p></div>
      <div className="tasks-form-actions"><button type="button" disabled={busy} onClick={() => void act(entry, false)}>恢复</button><button type="button" disabled={busy} onClick={() => void act(entry, true)}>永久删除</button></div>
    </li>)}</ul>
  </TaskUtilityDialog>
}
