import { useState } from 'react'
import type { TaskBackupPreview, TaskUISettings } from '../../../../shared/tasks'
import { useConfirm } from '../common/ConfirmProvider'
import TaskUtilityDialog from './TaskUtilityDialog'
import { TASK_PREFERENCES_KEY } from './taskViewPreferences'

const settingsKeys = { preferences: TASK_PREFERENCES_KEY, layoutOrder: 'chouyu:task-board-columns', selection: 'chouyu:task-selection' }
const currentSettings = (): TaskUISettings => ({ preferences: localStorage.getItem(settingsKeys.preferences) ?? '{}', layoutOrder: localStorage.getItem(settingsKeys.layoutOrder) ?? '{}', selection: localStorage.getItem(settingsKeys.selection) ?? 'today' })

export default function TaskBackupDialog({ onClose }: { onClose: () => void }) {
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState<TaskBackupPreview | null>(null)
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('')
    try { await operation() } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  const restore = async () => {
    if (!preview || busy) return
    if (!await confirm({ title: '恢复任务备份', message: `将用备份中的 ${preview.taskCount} 项任务、${preview.projectCount} 个清单及视图配置替换当前任务工作区。恢复前会自动保存当前数据备份。是否继续？`, confirmLabel: '恢复备份' })) return
    await run(async () => {
      const result = await window.electronAPI.tasks.restoreBackup(preview.token, currentSettings())
      setPreview(null)
      try {
        for (const key of Object.keys(settingsKeys) as (keyof TaskUISettings)[]) localStorage.setItem(settingsKeys[key], result.settings[key])
      } catch {
        setError(`任务数据已恢复，但界面配置保存失败。恢复前备份位于：${result.safetyBackupPath}`)
        return
      }
      window.location.reload()
    })
  }
  return <TaskUtilityDialog title="任务备份与恢复" busy={busy} onClose={onClose}>
    <p>备份包含任务、清单、分组、自定义字段、回收站，以及各视图的分组、排序和字段显示配置。</p>
    {error && <p role="alert" className="tasks-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {busy && <p role="status">正在处理，请稍候…</p>}
    <div className="tasks-form-actions">
      <button type="button" disabled={busy} onClick={() => void run(async () => { setNotice(await window.electronAPI.tasks.exportBackup(currentSettings()) ? '任务备份已保存。' : '已取消备份。') })}>导出完整备份</button>
      <button type="button" disabled={busy} onClick={() => void run(async () => { setPreview(await window.electronAPI.tasks.selectBackup()) })}>选择备份文件</button>
    </div>
    {preview && <div className="tasks-backup-preview"><p>备份时间：{new Date(preview.createdAt).toLocaleString()}</p><p>{preview.taskCount} 项任务 · {preview.projectCount} 个清单 · {preview.trashCount} 条回收记录</p><p>文件已校验。恢复会替换当前任务数据，并重新载入应用。</p><div className="tasks-form-actions"><button type="button" disabled={busy} onClick={() => void restore()}>恢复这份备份</button></div></div>}
  </TaskUtilityDialog>
}
