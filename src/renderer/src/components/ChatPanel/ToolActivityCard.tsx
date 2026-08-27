import type { ToolActivityData } from '../../../../shared/tools'
import { getToolRiskLabel } from '../../../../shared/tools'

export default function ToolActivityCard({ data }: { data: ToolActivityData }) {
  const terminal = ['completed', 'denied', 'error'].includes(data.status)
  const statusLabel = data.status === 'requested'
    ? '等待确认'
    : data.status === 'running'
      ? '执行中'
      : data.status === 'completed'
        ? '已完成'
        : data.status === 'denied'
          ? '已拒绝'
          : '执行失败'
  return (
    <div className={`tool-activity-card status-${data.status}`} role="status" aria-label={`${data.displayName}：${statusLabel}`}>
      <span className={`tool-activity-state${terminal ? '' : ' spinning'}`} aria-hidden="true">
        {terminal ? (
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            {data.status === 'completed' ? <path d="M3 8.5l3 3 7-7"/> : <path d="M4 4l8 8M12 4l-8 8"/>}
          </svg>
        ) : <span />}
      </span>
      <span className="tool-activity-content">
        <strong>{data.displayName}</strong>
        <span>{data.summary || getToolRiskLabel(data.risk)}</span>
      </span>
      <span className="tool-activity-status">{statusLabel}</span>
    </div>
  )
}
