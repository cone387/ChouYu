import type { MemoryInsights, MemoryStats } from '../../../../../shared/memory'
import { ARCHIVE_LABELS, TYPE_LABELS } from './labels'

interface MemoryStatsViewProps {
  stats: MemoryStats
  insights: MemoryInsights
}

export default function MemoryStatsView({ stats, insights }: MemoryStatsViewProps) {
  const maxTypeCount = Math.max(1, ...insights.byType.map((item) => item.count))
  const maxWeeklyCount = Math.max(1, ...insights.createdByWeek.map((item) => item.count))

  return (
    <>
      <div className="memory-stats" aria-label="记忆统计">
        <div><strong>{stats.active}</strong><span>已确认</span></div>
        <div><strong>{stats.pending}</strong><span>待确认</span></div>
        <div><strong>{stats.expiringSoon}</strong><span>7 天内过期</span></div>
        <div><strong>{(stats.databaseSize / 1024).toFixed(1)} KB</strong><span>本地数据库</span></div>
        <div><strong>{stats.embeddings}</strong><span>向量索引</span></div>
      </div>

      <details className="memory-insights-card">
        <summary>记忆统计概览</summary>
        <div className="memory-insights-content">
          <div className="memory-insight-kpis">
            <span><strong>{insights.clusters}</strong>主题</span><span><strong>{insights.clustered}</strong>已聚类</span><span><strong>{insights.savedCharacters}</strong>可压缩字符</span><span><strong>+{insights.helpful} / -{insights.unhelpful}</strong>来源反馈</span>
          </div>
          <div className="memory-insight-grid">
            <div><strong>类型分布</strong><ul>{insights.byType.map((item) => <li key={item.type}><span>{TYPE_LABELS[item.type]}</span><i><b style={{ width: `${item.count / maxTypeCount * 100}%` }} /></i><em>{item.count}</em></li>)}</ul></div>
            <div><strong>近 8 周新增</strong><div className="memory-week-chart" role="img" aria-label={`近 8 周新增记忆：${insights.createdByWeek.map((item) => `${item.label} ${item.count} 条`).join('，')}`}>{insights.createdByWeek.map((item) => <span key={item.label}><i style={{ height: `${Math.max(4, item.count / maxWeeklyCount * 100)}%` }} /><small>{item.label}</small><em>{item.count}</em></span>)}</div></div>
          </div>
          <div className="memory-archive-breakdown"><strong>归档构成</strong>{insights.archiveReasons.filter((item) => item.count > 0).map((item) => <span key={item.reason}>{ARCHIVE_LABELS[item.reason] || item.reason} {item.count}</span>)}{insights.archiveReasons.every((item) => item.count === 0) && <span>暂无归档记忆</span>}</div>
        </div>
      </details>
    </>
  )
}
