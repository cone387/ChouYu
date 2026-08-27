import { useEffect } from 'react'
import type { ToolApprovalRequest } from '../../../../shared/tools'
import { getToolRiskLabel } from '../../../../shared/tools'
import './ToolApprovalDialog.css'

interface ToolApprovalDialogProps {
  request: ToolApprovalRequest
  onResolve: (approved: boolean) => void
}

function formatArguments(arguments_: Record<string, unknown>): string {
  const entries = Object.entries(arguments_)
  if (entries.length === 0) return '此工具不需要额外参数。'
  return entries.map(([key, value]) => {
    const formatted = typeof value === 'string' ? value : JSON.stringify(value)
    return `${key}: ${formatted.length > 500 ? formatted.slice(0, 500) + '…' : formatted}`
  }).join('\n')
}

export default function ToolApprovalDialog({ request, onResolve }: ToolApprovalDialogProps) {
  useEffect(() => {
    const denyOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation()
        onResolve(false)
      }
    }
    window.addEventListener('keydown', denyOnEscape, true)
    return () => window.removeEventListener('keydown', denyOnEscape, true)
  }, [onResolve])

  return (
    <div className="tool-approval-overlay">
      <section className={`tool-approval-dialog risk-${request.risk}`} role="alertdialog" aria-modal="true" aria-labelledby="tool-approval-title" aria-describedby="tool-approval-description">
        <div className="tool-approval-icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l8 4v5c0 5-3.4 8-8 9-4.6-1-8-4-8-9V7zM9 12l2 2 4-4"/>
          </svg>
        </div>
        <div className="tool-approval-copy">
          <span className="tool-approval-kicker">AI 请求使用工具</span>
          <h2 id="tool-approval-title">{request.displayName}</h2>
          <p id="tool-approval-description">{request.description}</p>
        </div>
        <div className="tool-risk-label">
          <span aria-hidden="true" />
          {getToolRiskLabel(request.risk)}
        </div>
        <pre className="tool-approval-arguments">{formatArguments(request.arguments)}</pre>
        <p className="tool-approval-help">仅本次调用有效。拒绝后 AI 会收到“用户拒绝”结果并继续回答。</p>
        <div className="tool-approval-actions">
          <button type="button" autoFocus className="secondary" onClick={() => onResolve(false)}>拒绝</button>
          <button type="button" className="primary" onClick={() => onResolve(true)}>允许本次操作</button>
        </div>
      </section>
    </div>
  )
}
