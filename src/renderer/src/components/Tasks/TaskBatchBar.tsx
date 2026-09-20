import { useState } from 'react'
import type { TaskBatchAction, TaskProject } from '../../../../shared/tasks'

export default function TaskBatchBar({ count, visibleCount, busy, projects, onSelectAll, onClear, onAction }: {
  count: number; visibleCount: number; busy: boolean; projects: TaskProject[]
  onSelectAll: () => void; onClear: () => void; onAction: (action: TaskBatchAction) => void
}) {
  const [projectId, setProjectId] = useState('')
  const [date, setDate] = useState('')
  return <section className="tasks-batch-bar" aria-label="批量处理任务">
    <span>已选 {count} 项</span><button type="button" disabled={busy} onClick={onSelectAll}>选择当前已加载的 {visibleCount} 项</button><button type="button" disabled={busy} onClick={onClear}>取消选择</button>
    <button type="button" disabled={busy || !count} onClick={() => onAction({ kind: 'complete' })}>批量完成</button>
    <button type="button" disabled={busy || !count} onClick={() => onAction({ kind: 'reopen' })}>批量恢复</button>
    <label>移至清单<select aria-label="批量移动目标清单" value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">选择清单</option>{projects.filter(project => !project.archivedAt).map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
    <button type="button" disabled={busy || !count || !projectId} onClick={() => onAction({ kind: 'update', patch: { projectId } })}>批量移动</button>
    <label>截止日期<input type="date" aria-label="批量改期日期" value={date} onChange={event => setDate(event.target.value)} /></label>
    <button type="button" disabled={busy || !count || !date} title="保留具体时间；有起止时间的任务会同步平移开始日期" onClick={() => onAction({ kind: 'reschedule', date })}>批量改期</button>
  </section>
}
