import type { MemoryRecord } from '../../../../shared/memory'
import './MemoryCandidateCard.css'

const TYPE_LABELS: Record<string, string> = {
  fact: '事实',
  preference: '偏好',
  person: '人物',
  project: '项目',
  workflow: '工作方式'
}

interface MemoryCandidateCardProps {
  candidate: MemoryRecord
  remaining: number
  busy?: boolean
  onApprove: () => void
  onReject: () => void
}

export default function MemoryCandidateCard({ candidate, remaining, busy, onApprove, onReject }: MemoryCandidateCardProps) {
  return (
    <section className="memory-candidate-card" aria-labelledby="memory-candidate-title">
      <div className="memory-candidate-icon" aria-hidden="true">
        <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 4.5a3 3 0 015 0 3 3 0 015 0v7a3 3 0 01-5 0 3 3 0 01-5 0zM7 7h6M7 10h6"/>
        </svg>
      </div>
      <div className="memory-candidate-copy">
        <div>
          <strong id="memory-candidate-title">要记住这件事吗？</strong>
          <span>{TYPE_LABELS[candidate.type] || candidate.type}</span>
          {candidate.sensitivity === 'sensitive' && <span className="sensitive">敏感信息</span>}
        </div>
        <p>{candidate.content}</p>
        <small>来源：当前对话 · 可信度 {Math.round(candidate.confidence * 100)}%{remaining > 1 ? ` · 还有 ${remaining - 1} 条候选` : ''}</small>
      </div>
      <div className="memory-candidate-actions">
        <button type="button" onClick={onReject} disabled={busy}>不记住</button>
        <button type="button" className="primary" onClick={onApprove} disabled={busy}>确认记住</button>
      </div>
    </section>
  )
}
