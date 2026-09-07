import { useEffect, useState } from 'react'
import type { JournalDay } from '../../../../shared/journal'
import { journalRange } from './JournalEvidence'

const duration = (ms: number) => ms < 60_000 ? '不足 1 分钟' : `${Math.floor(ms / 60_000)} 分钟`
export function JournalDayPanel({ date, revision, onSettings }: { date: string; revision: number; onSettings(): void }) {
  const [day, setDay] = useState<JournalDay | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { setDay(null) }, [date])
  useEffect(() => {
    let active = true
    try { void window.electronAPI.journal.overview(journalRange(date)).then(value => { if (active) { setDay(value); setError('') } }).catch(reason => { if (active) setError(String(reason)) }) }
    catch (reason) { setError(String(reason)) }
    return () => { active = false }
  }, [date, revision])
  return <aside className="journal-day-panel" aria-label="当天概览">
    <h2>当天概览</h2>
    {error && <p role="alert">{error}</p>}
    {day ? <>
      <div className="journal-day-total"><strong>{Math.floor(day.durationMs / 60_000)}</strong><span>分钟采样时长</span></div>
      <p>{day.activityCount} 个活动片段 · {day.captureCount} 张画面</p>
      {day.firstAt !== null && day.lastAt !== null && <p>{new Date(day.firstAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} — {new Date(day.lastAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 的记录</p>}
      <section className="journal-evidence-health"><h3>{day.ocrReady ? '有正文可供分析' : '目前只有活动线索'}</h3><p>{day.ocrReady ? `${day.ocrReady} 张画面已识别到文字，总结可以提取更具体的内容。` : day.captureCount ? '画面尚未识别出正文，可前往关键画面检查 OCR 状态。' : '窗口标题能找回去过的地方，但无法说明正文、修改或成果。可按需开启画面与本地 OCR。'}</p>{day.ocrFailed > 0 && <p>{day.ocrFailed} 张 OCR 失败，可打开画面重试。</p>}<button onClick={onSettings}>调整记录范围</button></section>
      <section className="journal-app-breakdown"><h3>应用分布</h3>{day.apps.map(item => <div key={item.app}><div><span>{item.app.replace(/\.exe$/i, '')}</span><small>{duration(item.durationMs)}</small></div><progress max={Math.max(day.durationMs, 1)} value={item.durationMs} aria-label={`${item.app} ${duration(item.durationMs)}`} /></div>)}{!day.apps.length && <p>有记录后显示。</p>}</section>
      <p className="journal-footnote">时长来自间隔采样，不等于精确工时。总结中的建议需要你确认。</p>
    </> : !error && <p>正在读取当天记录…</p>}
  </aside>
}
