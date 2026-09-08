import type { HTMLAttributes } from 'react'

export default function WorkspaceHeader({ onHide, onClose, dragHandleProps }: {
  onHide: () => void
  onClose: () => void
  dragHandleProps: HTMLAttributes<HTMLDivElement>
}) {
  return <div className="workspace-header chat-panel-drag-handle" {...dragHandleProps}>
    <div className="chat-topbar-actions">
      <button type="button" className="topbar-btn" aria-label="隐藏面板" title="隐藏面板" onClick={onHide}><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 7h8"/></svg></button>
      <button type="button" className="topbar-btn" aria-label="关闭面板" title="关闭面板" onClick={onClose}><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m3 3 8 8M11 3l-8 8"/></svg></button>
    </div>
  </div>
}
