import { useEffect, useState } from 'react'
import { CONTACT_RUNTIME_ISSUE, CONTACT_RUNTIME_LABEL, type ContactRuntimeSnapshot } from '../../../../shared/contact-runtime'

const time = (at: number) => new Date(at).toLocaleString()
export function ContactRuntimeDetails({ snapshot, onRetry, busy = false }: {
  snapshot: ContactRuntimeSnapshot; onRetry: () => void; busy?: boolean
}) {
  const unavailable = snapshot.phase !== 'ready'
  return <div className={unavailable ? 'agent-error' : 'agent-caption'} data-contact-runtime={snapshot.phase}>
    {unavailable && <div role="status">{CONTACT_RUNTIME_LABEL[snapshot.phase]}{snapshot.phase === 'unavailable' || snapshot.phase === 'idle'
      ? <button type="button" disabled={busy} onClick={onRetry}>{busy ? '正在连接…' : '重试连接'}</button> : null}</div>}
    <details><summary>后台连接详情</summary>
      <p>{CONTACT_RUNTIME_LABEL[snapshot.phase]}</p>
      {snapshot.syncedAt !== undefined && <p>最近同步：{time(snapshot.syncedAt)}</p>}
      {snapshot.metrics && <p>运行中 {snapshot.metrics.activeRuns} / {snapshot.metrics.capacity} · 待投递 {snapshot.metrics.pendingDeliveries}（{time(snapshot.metrics.observedAt)}读取）</p>}
      {snapshot.metrics?.oldestPendingAt !== undefined && <p>最早待投递：{time(snapshot.metrics.oldestPendingAt)}</p>}
      {snapshot.metrics?.backup && <p>最近联系人备份：{snapshot.metrics.backup.lastSuccessAt ? time(snapshot.metrics.backup.lastSuccessAt) : '尚无成功记录'}
        {snapshot.metrics.backup.phase === 'waiting' ? ' · 等待安全保存' : snapshot.metrics.backup.phase === 'saving' ? ' · 正在保存'
          : snapshot.metrics.backup.phase === 'failed' ? ' · 本次未保存，保留上一份备份' : ''}</p>}
      {snapshot.issue && <p>最近记录：{CONTACT_RUNTIME_ISSUE[snapshot.issue.kind]} · {time(snapshot.issue.at)}</p>}
    </details>
  </div>
}

export default function ContactRuntimeStatus({ active }: { active: boolean }) {
  const [snapshot, setSnapshot] = useState<ContactRuntimeSnapshot>()
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!active) return
    let live = true
    const accept = (value: ContactRuntimeSnapshot) => {
      if (!live) return
      setError(''); setSnapshot(previous => !previous || value.revision >= previous.revision ? value : previous)
    }
    const off = window.electronAPI.agents.onRuntimeChanged(accept)
    void window.electronAPI.agents.runtimeStatus().then(accept).catch(() => { if (live) setError('暂时无法读取后台连接状态。') })
    return () => { live = false; off() }
  }, [active])
  const retry = async () => {
    if (busy) return
    setBusy(true); setError('')
    try { const next = await window.electronAPI.agents.retryRuntime(); setSnapshot(previous => !previous || next.revision >= previous.revision ? next : previous) }
    catch { setError('连接尚未恢复，请稍后重试。') }
    finally { setBusy(false) }
  }
  if (!active) return null
  return <>{error && <p className="agent-error" role="alert">{error}<button type="button" disabled={busy} onClick={() => void retry()}>重试连接</button></p>}
    {snapshot && <ContactRuntimeDetails snapshot={snapshot} busy={busy} onRetry={() => void retry()} />}</>
}
