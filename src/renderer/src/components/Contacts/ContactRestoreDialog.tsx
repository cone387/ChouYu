import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ContactBackupManifest } from '../../../../shared/contact-backups'

export default function ContactRestoreDialog({ group, restore, close }: {
  group: ContactBackupManifest; restore(): Promise<void>; close(): void
}) {
  const dialog = useRef<HTMLDialogElement>(null), title = useId()
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close() }, [])
  return createPortal(<dialog ref={dialog} className="contact-task-dialog" aria-labelledby={title} data-interactive
    onCancel={event => { event.preventDefault(); if (!busy) close() }}>
    <form onSubmit={event => { event.preventDefault(); if (busy) return; setBusy(true); setError('')
      void restore().catch(e => { setError(e instanceof Error ? e.message : '恢复失败，原文件仍保留。'); setBusy(false) })
    }}>
      <h3 id={title}>恢复联系人任务备份</h3>
      <p>恢复到 {new Date(group.createdAt).toLocaleString()}。此后的任务记录可能回退；现有数据库原文件会保留。</p>
      <p>备份包含联系人任务和执行检查点，不包含应用聊天库、附件、技能和 DSH 原始会话。恢复后保持保护状态，请逐项核对资料、外部操作和新增额度，再开始新的尝试。</p>
      {error && <p className="agent-error" role="alert">{error}</p>}
      <footer><button type="button" autoFocus disabled={busy} onClick={close}>取消</button>
        <button type="submit" disabled={busy}>{busy ? '正在恢复…' : '恢复此备份'}</button></footer>
    </form>
  </dialog>, document.body)
}
