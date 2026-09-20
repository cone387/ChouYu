import { useEffect, useState } from 'react'
import type { TaskSource } from '../../../../shared/tasks'
import type { JournalSavedItem } from '../../../../shared/journal'
import { journalRange } from '../Journal/JournalEvidence'
import { SavedSource } from '../Journal/JournalSaved'
import TaskUtilityDialog from './TaskUtilityDialog'

export default function TaskSourceDialog({ source, onClose, onChat }: { source: TaskSource; onClose: () => void; onChat?: (id: string) => Promise<void> }) {
  const [text, setText] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState<JournalSavedItem | null>(null)
  useEffect(() => {
    let alive = true
    void (async () => {
      if (source.kind === 'journal') {
        if (!source.date) throw new Error('来源日期缺失，无法定位原日志。')
        const detail = await window.electronAPI.journal.detail({ ...journalRange(source.date), id: source.id })
        if (alive) setText([detail.task.title, detail.task.text, detail.task.note, ...detail.activities.map(item => `${new Date(item.startedAt).toLocaleString()} · ${item.app} · ${item.title}`)].filter(Boolean).join('\n\n'))
      } else if (source.kind === 'continuation') {
        const item = (await window.electronAPI.journal.savedItems()).find(item => item.id === source.id)
        if (!item) throw new Error('接续卡已删除或不在当前数据中。')
        if (alive) { setSaved(item); setText([item.title, item.task.text, item.note].filter(Boolean).join('\n\n')) }
      } else {
        const item = (await window.electronAPI.db.getSessionWorkspace()).sessions.find(item => item.id === source.id)
        if (!item) throw new Error('来源会话已删除或不在当前数据中。')
        if (alive) setText(`${item.title}\n\n${item.preview}`)
      }
    })().catch(reason => { if (alive) setError(`无法读取来源：${reason instanceof Error ? reason.message : String(reason)} 任务本身仍然保留。`) }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [source])
  return <TaskUtilityDialog title="任务来源" onClose={onClose}>
    {loading && <p role="status">正在读取来源…</p>}
    {error && <p role="alert">{error}</p>}
    <p className="tasks-source-text">{text}</p>
    {saved && <SavedSource item={saved} onRecognized={() => {}} />}
    {!loading && !error && source.kind === 'chat' && onChat && <button type="button" onClick={() => void onChat(source.id).then(onClose).catch(reason => setError(String(reason)))}>打开来源会话</button>}
  </TaskUtilityDialog>
}
