import { useEffect, useState, type FormEvent } from 'react'
import type { TaskSelectField, TaskSelectFieldUpdateInput } from '../../../../shared/tasks'

interface TaskFieldsDialogProps {
  fields: TaskSelectField[]
  busy: boolean
  error: string
  onSave: (id: string | null, input: TaskSelectFieldUpdateInput) => Promise<TaskSelectField>
  onDelete: (field: TaskSelectField) => void
  onClose: () => void
}

const parseOptions = (text: string): string[] =>
  text.split('\n').map(line => line.trim()).filter(line => line.length > 0)

export default function TaskFieldsDialog({ fields, busy, error, onSave, onDelete, onClose }: TaskFieldsDialogProps) {
  const [rows, setRows] = useState(() => fields.map(field => ({ id: field.id, name: field.name, options: field.options.map(option => ({ ...option })) })))
  const [creating, setCreating] = useState<{ name: string; options: string } | null>(null)
  // 保存/删除后 fields 属性刷新:已编辑行保留草稿,新字段补入,被删字段移除
  useEffect(() => {
    setRows(current => fields.map(field => {
      const existing = current.find(row => row.id === field.id)
      return existing ?? { id: field.id, name: field.name, options: field.options.map(option => ({ ...option })) }
    }))
  }, [fields])

  const submitRow = (event: FormEvent, id: string) => {
    event.preventDefault()
    const row = rows.find(item => item.id === id)
    if (!row) return
    void onSave(id, { name: row.name, options: row.options.map(option => ({ ...(option.id.startsWith('new:') ? {} : { id: option.id }), name: option.name })) }).then(saved => setRows(current => current.map(item => item.id === id ? { id: saved.id, name: saved.name, options: saved.options.map(option => ({ ...option })) } : item))).catch(() => {})
  }
  const submitCreate = (event: FormEvent) => {
    event.preventDefault()
    if (!creating) return
    const name = creating.name.trim()
    if (!name) return
    void onSave(null, { name, options: parseOptions(creating.options) }).then(() => setCreating(null)).catch(() => {})
  }

  return <div className="tasks-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="tasks-dialog" role="dialog" aria-modal="true" aria-labelledby="tasks-field-dialog-title" onMouseDown={event => event.stopPropagation()}>
      <header className="tasks-dialog-header">
        <h2 id="tasks-field-dialog-title">自定义字段</h2>
        <button type="button" aria-label="关闭字段管理弹窗" onClick={onClose}>×</button>
      </header>
      <div className="tasks-form" aria-label="自定义字段管理">
        {error && <p role="alert" className="tasks-error">{error}</p>}
        <p className="tasks-fields-hint">单选字段可作为看板分组或任务属性，改名会保留任务关联。</p>
        {rows.map(row => (
          <form key={row.id} className="tasks-field-row" onSubmit={event => submitRow(event, row.id)} aria-label={`编辑字段 ${row.name}`}>
            <label>
              名称
              <input disabled={busy} value={row.name} aria-label={`字段名称 ${row.name}`}
                onChange={event => setRows(rows.map(item => item.id === row.id ? { ...item, name: event.target.value } : item))} />
            </label>
            <div className="tasks-field-options" role="group" aria-label={`字段选项 ${row.name}`}>
              <span>选项</span>
              {row.options.map((option, index) => <div className="tasks-field-option" key={option.id}>
                <input disabled={busy} value={option.name} aria-label={`${row.name} 选项 ${index + 1}`}
                  onChange={event => setRows(rows.map(item => item.id === row.id ? { ...item, options: item.options.map(value => value.id === option.id ? { ...value, name: event.target.value } : value) } : item))} />
                <button type="button" disabled={busy} aria-label={`删除选项 ${option.name}`} onClick={() => {
                  const saved = fields.find(field => field.id === row.id)?.options.some(value => value.id === option.id)
                  if (saved && !window.confirm(`删除选项「${option.name}」？保存后，使用该选项的任务将变为未设置。`)) return
                  setRows(rows.map(item => item.id === row.id ? { ...item, options: item.options.filter(value => value.id !== option.id) } : item))
                }}>删除</button>
              </div>)}
              <button type="button" disabled={busy || row.options.length >= 30} onClick={() => setRows(rows.map(item => item.id === row.id ? { ...item, options: [...item.options, { id: `new:${crypto.randomUUID()}`, name: '' }] } : item))}>添加选项 +</button>
            </div>
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
              <input disabled={busy} value={creating.name} autoFocus aria-label="新字段名称" placeholder="例如：阶段"
                onChange={event => setCreating({ ...creating, name: event.target.value })} />
            </label>
            <label>
              选项
              <textarea disabled={busy} value={creating.options} rows={3} aria-label="新字段选项" placeholder={'设计\n开发\n验收'}
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
