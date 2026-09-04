import { useState } from 'react'
import type { MemoryImportAction, MemoryImportPreview } from '../../../../../shared/memory'
import { TYPE_LABELS } from './labels'

interface MemoryImportPanelProps {
  run: (id: string, action: () => Promise<unknown>) => Promise<boolean>
  refresh: () => Promise<void>
  onConfirmClear: () => void
}

export default function MemoryImportPanel({ run, refresh, onConfirmClear }: MemoryImportPanelProps) {
  const [importPreview, setImportPreview] = useState<MemoryImportPreview | null>(null)
  const [importActions, setImportActions] = useState<Record<string, MemoryImportAction>>({})
  const [importBusy, setImportBusy] = useState(false)
  const [importStatus, setImportStatus] = useState('')
  const [confirmImport, setConfirmImport] = useState(false)

  const previewImport = async () => {
    setImportBusy(true)
    setImportStatus('正在读取并检查导入文件…')
    try {
      const preview = await window.electronAPI.memory.importPreview()
      if (preview.canceled) {
        setImportStatus('已取消导入。')
        return
      }
      setImportPreview(preview)
      setImportActions(Object.fromEntries(preview.items.map((item) => [item.id, item.suggestedAction])))
      setConfirmImport(false)
      setImportStatus(`已检查 ${preview.items.length} 条可导入记忆；忽略无效 ${preview.invalid} 条，阻止敏感内容 ${preview.blockedSecrets} 条。`)
    } catch (reason) {
      setImportStatus(reason instanceof Error ? reason.message : '记忆导入预览失败。')
    } finally {
      setImportBusy(false)
    }
  }

  const commitImport = async () => {
    if (!importPreview) return
    setImportBusy(true)
    setImportStatus('正在导入记忆…')
    try {
      const result = await window.electronAPI.memory.importCommit(importPreview.items.map((item) => ({ item, action: importActions[item.id] || 'skip' })))
      setImportStatus(`导入完成：新增 ${result.added}，并存 ${result.kept}，替换 ${result.replaced}，跳过 ${result.skipped}，失败 ${result.failed}。`)
      setImportPreview(null)
      setImportActions({})
      setConfirmImport(false)
      await refresh()
    } catch (reason) {
      setImportStatus(reason instanceof Error ? reason.message : '记忆导入失败。')
    } finally {
      setImportBusy(false)
    }
  }

  return (
    <>
      {importPreview && <section className="memory-import-panel" aria-label="记忆导入预览">
        <div className="memory-import-heading"><div><strong>导入预览 · {importPreview.fileName}</strong><span>逐条确认处理方式，提交前不会写入数据库。</span></div><button type="button" onClick={() => { setImportPreview(null); setConfirmImport(false) }}>关闭</button></div>
        <div className="memory-import-list">
          {importPreview.items.map((item) => <article key={item.id} className={`status-${item.status}`}>
            <div><span>{item.status === 'new' ? '新增' : item.status === 'duplicate' ? '重复' : item.conflictKind === 'contradiction' ? '冲突' : '更新'}</span><strong>{TYPE_LABELS[item.candidate.type]}</strong><select value={importActions[item.id] || item.suggestedAction} disabled={item.status === 'duplicate'} onChange={(event) => setImportActions((previous) => ({ ...previous, [item.id]: event.target.value as MemoryImportAction }))} aria-label={`“${item.candidate.content}”的导入方式`}>{item.status === 'new' && <option value="add">新增</option>}{item.status === 'conflict' && <><option value="keep">与已有记忆并存</option><option value="replace">替换已有记忆</option></>}<option value="skip">跳过</option></select></div>
            <p>{item.candidate.content}</p>
            {item.existingContent && <div className="memory-import-existing"><span>已有</span><p>{item.existingContent}</p><small>{item.reason}</small></div>}
          </article>)}
        </div>
        <div className="memory-import-actions">{confirmImport ? <><span>确认按当前选择导入？替换操作会归档旧记忆。</span><button type="button" onClick={() => setConfirmImport(false)}>取消</button><button type="button" className="primary" onClick={() => { void commitImport() }} disabled={importBusy}>确认导入</button></> : <button type="button" className="primary" onClick={() => setConfirmImport(true)} disabled={importBusy || importPreview.items.length === 0}>提交导入</button>}</div>
      </section>}

      <div className="memory-footer-actions">
        <button type="button" onClick={() => { void previewImport() }} disabled={importBusy}>{importBusy ? '处理中…' : '导入 JSON'}</button>
        <button type="button" onClick={() => { void run('export', () => window.electronAPI.memory.export()) }}>导出 JSON</button>
        <button type="button" className="danger" onClick={onConfirmClear}>忘记全部</button>
      </div>
      {importStatus && <div className="memory-import-status" role="status">{importStatus}</div>}
    </>
  )
}
