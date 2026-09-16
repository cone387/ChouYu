import { useEffect, useState, type FormEvent } from 'react'
import type { TaskSelectField, TaskSelectFieldInput } from '../../../../shared/tasks'

interface TaskFieldsDialogProps {
  fields: TaskSelectField[]
  busy: boolean
  onSave: (id: string | null, input: TaskSelectFieldInput) => void
  onDelete: (field: TaskSelectField) => void
  onClose: () => void
}

const parseOptions = (text: string): string[] =>
  text.split('\n').map(line => line.trim()).filter(line => line.length > 0)

export default function TaskFieldsDialog({ fields, busy, onSave, onDelete, onClose }: TaskFieldsDialogProps) {
  const [rows, setRows] = useState(() => fields.map(field => ({ id: field.id, name: field.name, options: field.options.map(option => option.name).join('\n') })))
  const [creating, setCreating] = useState<{ name: string; options: string } | null>(null)
  // 保存/删除后 fields 属性刷新:已编辑行保留草稿,新字段补入,被删字段移除
  useEffect(() => {
    setRows(fields.map(field => {
      const existing = rows.find(row => row.id === field.id)
      return existing ?? { id: field.id, name: field.name, options: field.options.map(option => option.name).join('\n') }
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields])

  const submitRow = (event: FormEvent, id: string) => {
    event.preventDefault()
    const row = rows.find(item => item.id === id)
    if (!row) return
    onSave(id, { name: row.name, options: parseOptions(row.options) })
  }
  const submitCreate = (event: FormEvent) => {
    event.preventDefault()
    if (!creating) return
    const name = creating.name.trim()
    if (!name) return
    onSave(null, { name, options: parseOptions(creating.options) })
    setCreating(null)
  }

  return <div className="tasks-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="tasks-dialog" role="dialog" aria-modal="true" aria-labelledby="tasks-field-dialog-title" onMouseDown={event => event.stopPropagation()}>
      <header className="tasks-dialog-header">
        <h2 id="tasks-field-dialog-title">自定义字段</h2>
        <button type="button" aria-label="关闭字段管理弹窗" onClick={onClose}>×</button>
      </header>
      <div className="tasks-form" aria-label="自定义字段管理">
        <p className="tasks-fields-hint">单选字段可作为看板分组或任务属性。每行一个选项。</p>
        {rows.map(row => (
          <form key={row.id} className="tasks-field-row" onSubmit={event => submitRow(event, row.id)} aria-label={`编辑字段 ${row.name}`}>
            <label>
              名称
              <input value={row.name} aria-label={`字段名称 ${row.name}`}
                onChange={event => setRows(rows.map(item => item.id === row.id ? { ...item, name: event.target.value } : item))} />
            </label>
            <label>
              选项
              <textarea value={row.options} rows={Math.min(6, Math.max(2, row.options.split('\n').length))} aria-label={`字段选项 ${row.name}`}
                onChange={event => setRows(rows.map(item => item.id === row.id ? { ...item, options: event.target.value } : item))} />
            </label>
            <div className="tasks-form-actions">
              <button type="submit" disabled={busy || !row.name.trim()}>保存</button>
              <button type="button" className="tasks-item-menu-danger" disabled={busy}
                onClick={() => {
                  const target = fields.find(field => field.id === row.id)
                  if (target && window.confirm(`删除字段「${row.name}」？任务上的对应值会被清除。`)) onDelete(target)
                }}>删除</button>
            </div>
          </form>
        ))}
        {creating === null
          ? <button type="button" className="tasks-fields-add" onClick={() => setCreating({ name: '', options: '' })}>新建字段 +</button>
          : <form className="tasks-field-row" onSubmit={submitCreate} aria-label="新建字段">
            <label>
              名称
              <input value={creating.name} autoFocus aria-label="新字段名称" placeholder="例如：阶段"
                onChange={event => setCreating({ ...creating, name: event.target.value })} />
            </label>
            <label>
              选项
              <textarea value={creating.options} rows={3} aria-label="新字段选项" placeholder={'待办\n进行中\n已完成'}
                onChange={event => setCreating({ ...creating, options: event.target.value })} />
            </label>
            <div className="tasks-form-actions">
              <button type="submit" disabled={busy || !creating.name.trim()}>创建</button>
              <button type="button" onClick={() => setCreating(null)}>取消</button>
            </div>
          </form>}
      </div>
    </div>
  </div>
}
