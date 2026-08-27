import { useEffect, useMemo, useState } from 'react'
import type { CaptureSourceInfo, VisualQuickAction } from '../../../../shared/capture'
import './WindowCapturePicker.css'

export type CaptureAction = 'attach' | VisualQuickAction

interface WindowCapturePickerProps {
  sources: CaptureSourceInfo[]
  loading: boolean
  error?: string
  onClose: () => void
  onRefresh: () => void
  onCapture: (source: CaptureSourceInfo, action: CaptureAction) => void
}

const ACTIONS: Array<{ id: CaptureAction; label: string }> = [
  { id: 'attach', label: '添加截图' },
  { id: 'ocr', label: '识别文字' },
  { id: 'summarize', label: '总结内容' },
  { id: 'translate', label: '翻译文字' }
]

export default function WindowCapturePicker({ sources, loading, error, onClose, onRefresh, onCapture }: WindowCapturePickerProps) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'all' | 'window' | 'screen'>('all')
  const [action, setAction] = useState<CaptureAction>('attach')
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return sources.filter((source) =>
      (kind === 'all' || source.kind === kind)
      && (!normalized || source.name.toLowerCase().includes(normalized))
    )
  }, [kind, query, sources])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', closeOnEscape, true)
    return () => window.removeEventListener('keydown', closeOnEscape, true)
  }, [onClose])

  return (
    <div className="window-capture-overlay" role="dialog" aria-modal="true" aria-labelledby="window-capture-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="window-capture-dialog">
        <header className="window-capture-header">
          <div>
            <span>桌面感知</span>
            <h2 id="window-capture-title">选择窗口或屏幕</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭窗口选择器">×</button>
        </header>

        <div className="window-capture-actions" role="radiogroup" aria-label="截图后操作">
          {ACTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={action === item.id ? 'active' : ''}
              onClick={() => setAction(item.id)}
              role="radio"
              aria-checked={action === item.id}
            >{item.label}</button>
          ))}
        </div>

        <div className="window-capture-filters">
          <label>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>
            </svg>
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索窗口…" aria-label="搜索窗口" />
          </label>
          <div className="window-capture-kind" role="tablist" aria-label="捕获源类型">
            <button type="button" className={kind === 'all' ? 'active' : ''} onClick={() => setKind('all')} role="tab" aria-selected={kind === 'all'}>全部</button>
            <button type="button" className={kind === 'window' ? 'active' : ''} onClick={() => setKind('window')} role="tab" aria-selected={kind === 'window'}>窗口</button>
            <button type="button" className={kind === 'screen' ? 'active' : ''} onClick={() => setKind('screen')} role="tab" aria-selected={kind === 'screen'}>屏幕</button>
          </div>
        </div>

        <div className="window-capture-grid" aria-busy={loading}>
          {filtered.map((source) => (
            <button key={source.id} type="button" className="window-capture-source" onClick={() => onCapture(source, action)} title={source.name} disabled={loading}>
              <span className="window-capture-thumbnail">
                <img src={source.thumbnail} alt="" />
                <span>{source.kind === 'screen' ? '屏幕' : '窗口'}</span>
              </span>
              <span className="window-capture-source-name">
                {source.appIcon && <img src={source.appIcon} alt="" />}
                <span>{source.name}</span>
              </span>
            </button>
          ))}

          {loading && sources.length === 0 && (
            <div className="window-capture-empty" role="status">
              <span className="window-capture-spinner" aria-hidden="true" />
              正在读取可用窗口…
            </div>
          )}
          {!loading && filtered.length === 0 && !error && (
            <div className="window-capture-empty">没有匹配的窗口，请尝试其他关键词。</div>
          )}
          {error && (
            <div className="window-capture-empty error" role="alert">
              <span>{error}</span>
              <button type="button" onClick={onRefresh}>重新读取</button>
            </div>
          )}
        </div>

        <footer className="window-capture-footer">
          <span>选择后将隐藏 ChouYu，再捕获目标内容。</span>
          <button type="button" onClick={onRefresh} disabled={loading}>刷新列表</button>
        </footer>
      </div>
    </div>
  )
}
