import { useState } from 'react'
import TaskIcon from './TaskIcon'

export default function TaskDisplayGroupForm({ initialName, editing, onSave, onCancel }: {
  initialName: string
  editing: boolean
  onSave: (name: string) => string | void
  onCancel: () => void
}) {
  const [name, setName] = useState(initialName)
  const [error, setError] = useState('')
  return <form className="tasks-display-group-form" aria-label={editing ? '重命名任务分组' : '新建任务分组'} onSubmit={event => {
    event.preventDefault()
    if (!name.trim()) { setError('请输入分组名称。'); return }
    setError(onSave(name.trim()) ?? '')
  }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel() } }}>
    <TaskIcon name="group" />
    <input autoFocus aria-label="任务分组名称" placeholder="输入分组名称" maxLength={50} value={name} onChange={event => { setName(event.target.value); setError('') }} />
    <button type="submit">{editing ? '保存' : '创建分组'}</button>
    <button type="button" onClick={onCancel}>取消</button>
    {error && <p role="alert" className="tasks-error">{error}</p>}
  </form>
}
