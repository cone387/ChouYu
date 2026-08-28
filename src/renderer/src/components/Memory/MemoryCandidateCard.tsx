import type { MemoryConflictAction, MemoryRecord } from '../../../../shared/memory'
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
  onResolve: (action: MemoryConflictAction | 'approve') => void
}

export default function MemoryCandidateCard({ candidate, remaining, busy, onResolve }: MemoryCandidateCardProps) {
  const conflicts = candidate.conflicts?.filter((conflict) => conflict.status === 'pending') || []
  const conflict = conflicts[0]
  return (
    <section className={`memory-candidate-card${conflict ? ' has-conflict' : ''}`} aria-labelledby="memory-candidate-title">
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
        {conflict && (
          <div className="memory-candidate-conflict">
            <div className="memory-candidate-conflict-title">
              <strong>{conflict.kind === 'contradiction' ? '发现冲突' : '可能是更新'}</strong>
              <span>{conflict.reason}</span>
            </div>
            <div className="memory-candidate-compare">
              <div><span>已有记忆</span><p>{conflict.existingContent}</p></div>
              <div><span>新候选</span><p>{candidate.content}</p></div>
            </div>
            {conflicts.length > 1 && <small>另有 {conflicts.length - 1} 条相关记忆会一起处理</small>}
          </div>
        )}
        <small>来源：当前对话 · 可信度 {Math.round(candidate.confidence * 100)}%{remaining > 1 ? ` · 还有 ${remaining - 1} 条候选` : ''}</small>
      </div>
      <div className="memory-candidate-actions">
        {conflict ? <>
          <button type="button" onClick={() => onResolve('reject')} disabled={busy}>拒绝新记忆</button>
          <button type="button" onClick={() => onResolve('keep')} disabled={busy}>两条都保留</button>
          <button type="button" className="replace" onClick={() => onResolve('replace')} disabled={busy}>用新记忆替换</button>
        </> : <>
          <button type="button" onClick={() => onResolve('reject')} disabled={busy}>不记住</button>
          <button type="button" className="primary" onClick={() => onResolve('approve')} disabled={busy}>确认记住</button>
        </>}
      </div>
    </section>
  )
}
