import { useCallback, useEffect, useState } from 'react'
import type { StorageStatus } from '../../../../shared/storage'
import './StorageNotice.css'

export default function StorageNotice() {
  const [status, setStatus] = useState<StorageStatus>({ error: null, notice: null, revision: -1 })
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const acceptStatus = useCallback((next: StorageStatus) => {
    setStatus((previous) => next.revision >= previous.revision ? next : previous)
  }, [])

  useEffect(() => {
    let active = true
    const accept = (next: StorageStatus) => { if (active) acceptStatus(next) }
    const unsubscribe = window.electronAPI.db.onStorageStatus(accept)
    void window.electronAPI.db.getStorageStatus().then(accept).catch(() => {
      if (active) setActionError('无法获取保存状态，请重新打开应用检查数据。')
    })
    return () => { active = false; unsubscribe() }
  }, [acceptStatus])

  const retry = async () => {
    setBusy(true)
    setActionError('')
    try {
      acceptStatus(await window.electronAPI.db.retrySave())
    } catch {
      setActionError('重试失败，请检查数据目录后再试。')
    } finally {
      setBusy(false)
    }
  }

  const openDirectory = async () => {
    try {
      const error = await window.electronAPI.db.openDataDirectory()
      setActionError(error ? '无法打开数据目录，请检查目录权限。' : '')
    } catch {
      setActionError('无法打开数据目录，请稍后重试。')
    }
  }

  if (!status.error && !status.notice && !actionError) return null
  return (
    <aside data-interactive className="storage-notice" role="alert" aria-label="聊天数据保存状态" aria-busy={busy}>
      <strong>{status.error ? '数据尚未保存' : '数据恢复提示'}</strong>
      {status.error && <p>{status.error}</p>}
      {status.notice && <p>{status.notice}</p>}
      {actionError && <p>{actionError}</p>}
      <div className="storage-notice-actions">
        {status.error && <button type="button" disabled={busy} onClick={() => { void retry() }}>{busy ? '正在重试…' : '重试保存'}</button>}
        <button type="button" onClick={() => { void openDirectory() }}>打开数据目录</button>
        {!status.error && <button type="button" onClick={() => {
          void window.electronAPI.db.dismissStorageNotice().then((next) => {
            acceptStatus(next)
            setActionError('')
          }).catch(() => setActionError('暂时无法关闭提示，请稍后重试。'))
        }}>知道了</button>}
      </div>
    </aside>
  )
}
