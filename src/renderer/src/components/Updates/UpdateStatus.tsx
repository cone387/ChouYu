import { useEffect, useState } from 'react'
import type { AppUpdateState } from '../../../../shared/updates'
import './UpdateStatus.css'

export function newestUpdateState(current: AppUpdateState, incoming: AppUpdateState): AppUpdateState {
  return incoming.revision >= current.revision ? incoming : current
}

export function updatePresentation(state: AppUpdateState) {
  switch (state.phase) {
    case 'checking': return { label: '检查中…', detail: '正在检查更新…', action: 'check', disabled: true, visible: false } as const
    case 'upToDate': return { label: '检查更新', detail: '已是最新版本', action: 'check', disabled: false, visible: false } as const
    case 'available': return { label: '下载更新', detail: `发现新版本 v${state.version}`, action: 'download', disabled: false, visible: true } as const
    case 'downloading': return { label: `下载 ${Math.floor(state.percent || 0)}%`, detail: `正在后台下载 v${state.version}，可以继续使用`, action: 'download', disabled: true, visible: true } as const
    case 'ready': return { label: '重启更新', detail: `v${state.version} 已下载，重启后完成更新`, action: 'install', disabled: false, visible: true } as const
    case 'installing': return { label: '正在重启…', detail: '正在保存数据并重启更新…', action: 'install', disabled: true, visible: true } as const
    case 'error': return { label: '重试更新', detail: state.error || '更新失败，请重试', action: state.version ? 'download' : 'check', disabled: false, visible: Boolean(state.version) || state.errorStage === 'install' } as const
    case 'unsupported': return { label: '检查更新', detail: '开发模式下无法检查更新', action: 'check', disabled: true, visible: false } as const
    default: return { label: '检查更新', detail: '自动检查并下载更新，准备好后会在顶部提示', action: 'check', disabled: false, visible: false } as const
  }
}

export default function UpdateStatus({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<AppUpdateState>({ revision: -1, phase: 'idle' })
  const [requestError, setRequestError] = useState('')
  useEffect(() => {
    let mounted = true
    const receive = (next: AppUpdateState) => {
      if (!mounted) return
      setState(current => newestUpdateState(current, next))
      setRequestError('')
    }
    // Subscribe first: a delayed snapshot must not overwrite a newer progress/ready event.
    const unsubscribe = window.electronAPI.update.onState(receive)
    void window.electronAPI.update.getState().then(receive).catch(() => {
      if (mounted) setRequestError('暂时无法读取更新状态，请重试')
    })
    return () => { mounted = false; unsubscribe() }
  }, [])
  const view = updatePresentation(state)
  if (compact && !view.visible) return null
  const activate = async () => {
    setRequestError('')
    try {
      const next = await (view.action === 'check' ? window.electronAPI.checkForUpdates() : window.electronAPI.update[view.action]())
      setState(current => newestUpdateState(current, next))
    } catch { setRequestError('操作未完成，请重试') }
  }
  const detail = requestError || view.detail
  return <div className={compact ? 'update-status update-status-compact' : 'update-status update-status-about'}
    data-update-phase={state.phase} onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}>
    <button type="button" className={compact ? 'update-status-button' : 'settings-about-update-btn'}
      disabled={view.disabled} onClick={() => { void activate() }} title={detail}
      aria-label={`${view.label}：${detail}`}>
      {compact && <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 2v8m-3-3 3 3 3-3M3 11v3h10v-3"/></svg>}
      <span>{view.label}</span>
    </button>
    {!compact && <p className="update-status-detail" role="status">{detail}</p>}
  </div>
}
