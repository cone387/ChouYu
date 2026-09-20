import { useState } from 'react'
import TaskCollectionDialog from './TaskCollectionDialog'

export default function TaskDisplayGroupDialog({ initialName, editing, onSave, onCancel }: {
  initialName: string
  editing: boolean
  onSave: (name: string) => string | void
  onCancel: () => void
}) {
  const [name, setName] = useState(initialName)
  const [error, setError] = useState('')
  return <TaskCollectionDialog title={editing ? '重命名任务分组' : '新建任务分组'}
    name={name} nameLabel="任务分组名称" formClassName="tasks-display-group-form"
    onNameChange={value => { setName(value); setError('') }} busy={false} error={error} editing={editing}
    onClose={onCancel} onSubmit={event => {
      event.preventDefault()
      if (!name.trim()) { setError('请输入分组名称。'); return }
      setError(onSave(name.trim()) ?? '')
    }} />
}
