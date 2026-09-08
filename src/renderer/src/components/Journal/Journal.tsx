import { useCallback, useEffect, useRef, useState } from 'react'
import type { JournalConfig, JournalPage, JournalStatus } from '../../../../shared/journal'
import { DEFAULT_JOURNAL_CONFIG } from '../../../../shared/journal'
import './Journal.css'
import { JournalUsageHistory } from './JournalUsage'
import { JournalCaptures, JournalSummaryView, JournalAsk } from './JournalEvidence'
import { JournalDayPanel } from './JournalDayPanel'
import { JournalTasks } from './JournalTasks'
import { JournalDetailPanel } from './JournalDetailPanel'
import { recordingTogglePatch } from '../../core/journal-recording'

const today = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
const time = (value: number) => new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
const duration = (value: number) => value <= 0 ? '0 分钟' : value < 60_000 ? '不足 1 分钟' : value < 3600_000 ? `${Math.floor(value / 60_000)} 分钟` : `${Math.floor(value / 3600_000)} 小时 ${Math.floor(value / 60_000) % 60} 分钟`
const labels: Record<JournalStatus['state'], string> = { off: '尚未开启', paused: '已手动暂停', locked: '锁屏或休眠，已暂停', starting: '正在连接采集器', recording: '正在记录', idle: '电脑空闲，等待活动', excluded: '当前应用不记录', error: '记录遇到问题' }

export default function Journal({ active = true, searchRequest }: { active?: boolean; searchRequest?: { date: string; query: string; id: number } }) {
  const [status, setStatus] = useState<JournalStatus | null>(null)
  const [date, setDate] = useState(today)
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<JournalPage>({ items: [], total: 0, durationMs: 0 })
  const [settings, setSettings] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [excluded, setExcluded] = useState('')
  const [retention, setRetention] = useState(30)
  const [captureEnabled, setCaptureEnabled] = useState(DEFAULT_JOURNAL_CONFIG.captureEnabled)
  const [captureInterval, setCaptureInterval] = useState(DEFAULT_JOURNAL_CONFIG.captureIntervalSeconds)
  const [storageLimit, setStorageLimit] = useState(DEFAULT_JOURNAL_CONFIG.maxStorageMB)
  const [view, setView] = useState<'activity' | 'captures' | 'summary' | 'ask' | 'usage'>('activity')
  const [activityMode, setActivityMode] = useState<'tasks' | 'raw'>('tasks')
  useEffect(() => {
    if (!searchRequest) return
    setDate(searchRequest.date); setQuery(searchRequest.query); setOffset(0); setView('activity'); setActivityMode('raw')
  }, [searchRequest])
  const [selectedSource, setSelectedSource] = useState('')
  const [deletedRevision, setDeletedRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [revision, setRevision] = useState(0)
  const statusRevision = useRef(0)
  const settingsDialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = settingsDialog.current
    if (settings && active) dialog?.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [settings, active])

  useEffect(() => {
    if (!active) return
    let mounted = true
    const update = async () => {
      const version = statusRevision.current
      try {
        const next = await window.electronAPI.journal.status()
        if (mounted && version === statusRevision.current) setStatus(next)
      } catch (reason) { if (mounted) setError(String(reason)) }
    }
    void update()
    setRevision(value => value + 1)
    const timer = setInterval(() => { void update(); setRevision(value => value + 1) }, 5000)
    return () => { mounted = false; clearInterval(timer) }
  }, [active])

  useEffect(() => {
    if (!active) return
    let mounted = true
    const timer = setTimeout(() => {
      const from = new Date(`${date}T00:00:00`).getTime()
      const nextDay = new Date(from); nextDay.setDate(nextDay.getDate() + 1)
      if (!Number.isFinite(from)) { setError('请选择有效日期。'); setLoading(false); return }
      void window.electronAPI.journal.list({ from, to: nextDay.getTime(), query, offset }).then(result => {
        if (mounted) {
          if (offset && offset >= result.total) { setOffset(Math.max(0, Math.floor((result.total - 1) / 100) * 100)); return }
          setPage(result); setLoading(false); setError('')
        }
      }).catch(reason => { if (mounted) { setError(String(reason)); setLoading(false) } })
    }, 180)
    return () => { mounted = false; clearTimeout(timer) }
  }, [date, query, offset, revision, active])

  const configure = useCallback(async (patch: Partial<JournalConfig>) => {
    setBusy(true); setError(''); setNotice(''); statusRevision.current++
    try { setStatus(await window.electronAPI.journal.configure(patch)); setNotice('设置已保存'); setRevision(value => value + 1); return true }
    catch (reason) { setError(String(reason)); setSettingsError(String(reason)); return false }
    finally { statusRevision.current++; setBusy(false) }
  }, [])

  const openSettings = () => {
    setSettingsError('')
    setExcluded(status?.config.excludedApps.join('\n') || '')
    setRetention(status?.config.retentionDays || 30)
    setCaptureEnabled(status?.config.captureEnabled ?? DEFAULT_JOURNAL_CONFIG.captureEnabled)
    setCaptureInterval(status?.config.captureIntervalSeconds ?? DEFAULT_JOURNAL_CONFIG.captureIntervalSeconds)
    setStorageLimit(status?.config.maxStorageMB ?? DEFAULT_JOURNAL_CONFIG.maxStorageMB)
    setSettings(value => !value)
  }
  const changeDate = (value: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(new Date(`${value}T00:00:00`).getTime())) return; setDate(value); setOffset(0); setLoading(true); setConfirmDelete(false); setSelectedSource('') }
  const shiftDate = (days: number) => {
    const current = new Date(`${date}T12:00:00`); current.setDate(current.getDate() + days)
    changeDate(`${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`)
  }
  const deleteDay = async () => {
    setBusy(true); setError('')
    const start = new Date(`${date}T00:00:00`); const end = new Date(start); end.setDate(end.getDate() + 1)
    try {
      await window.electronAPI.journal.deleteRange({ from: start.getTime(), to: end.getTime() })
      setConfirmDelete(false); setOffset(0); setNotice('当天记录已删除')
    } catch (reason) { setError(String(reason)) }
    finally { setBusy(false); setRevision(value => value + 1); setDeletedRevision(value => value + 1); setSelectedSource('') }
  }

  return <main className="journal-shell">
    <header className="journal-header">
      <div className="journal-brand"><h1>工作日志</h1><p>回看一天，接着往下做。</p></div>
      <div className="journal-controls">
        <span className={`journal-status state-${status?.state || 'off'}`} role="status"><i />{status ? `${labels[status.state]}${status.config.enabled ? status.permissionNotice ? ' · 仅应用名称' : status.captureError ? ' · 画面异常' : status.config.captureEnabled ? ' · 活动＋画面＋本地 OCR' : ' · 仅记录标题' : ''}` : '正在加载'}</span>
        <div className="journal-recording-actions">
          <button type="button" className="journal-recording-switch" role="switch" aria-label="活动记录"
            aria-checked={Boolean(status?.config.enabled && !status.config.paused)}
            disabled={busy || !status || (!status.config.enabled && (!status.supported || Boolean(status.error)))}
            title={status?.config.enabled && !status.config.paused ? '暂停记录' : '开启记录'}
            onClick={() => { if (status) void configure(recordingTogglePatch(status.config)) }}>
            <span>记录</span><i aria-hidden="true" />
          </button>
          <button onClick={openSettings} disabled={!status} aria-label="记录设置" aria-expanded={settings}>记录设置</button>
        </div>
      </div>
    </header>

    {error && <div className="journal-error" role="alert">{error}<button onClick={() => { setError(''); setRevision(value => value + 1) }}>重试加载</button></div>}
    {status?.error && <div className="journal-error" role="alert">{status.error}</div>}
    {status?.captureError && <div className="journal-error" role="alert">{status.captureError}</div>}
    {status?.config.enabled && status.permissionNotice && <p className="journal-notice" role="status">{status.permissionNotice}</p>}
    {notice && <p className="journal-notice" role="status">{notice}</p>}
    {status?.analysis && <p className="journal-analysis-status" role="status">{status.analysis === 'summary' ? '日志总结正在生成' : '正在根据日志查找答案'}<button onClick={() => void window.electronAPI.journal.cancelAnalysis().catch(reason => setError(String(reason)))}>取消分析</button></p>}

    {!status?.config.enabled && status && <section className="journal-welcome">
      <div><p>默认记录活动、前台画面并在本机识别文字。关闭窗口后继续，可在托盘暂停。</p></div>
      {!status.supported && <span>目前仅支持 Windows 和 macOS</span>}
    </section>}

    {settings && <dialog ref={settingsDialog} className="journal-detail journal-settings-dialog" aria-labelledby="journal-settings-title" onCancel={() => setSettings(false)} onClose={() => setSettings(false)}>
      <header><h2 id="journal-settings-title">记录设置</h2><button aria-label="关闭记录设置" onClick={() => setSettings(false)}>关闭</button></header>
      {settingsError && <p className="journal-error" role="alert">{settingsError}</p>}
      <section className="journal-settings" aria-label="记录范围设置">
      <div><h2>记录范围</h2><p>连续 2 分钟无键鼠活动时暂停计时；窗口标题可能包含文档或网页名称。排除应用不保存标题，已有记录可按日期删除。</p>
        <label>排除的应用进程<textarea aria-label="排除的应用进程" value={excluded} onChange={event => setExcluded(event.target.value)} placeholder={'chrome.exe\nwechat.exe'} rows={5} /></label>
      </div>
      <div><label>保留期限<select aria-label="保留期限" value={retention} onChange={event => setRetention(Number(event.target.value))}><option value={7}>7 天</option><option value={30}>30 天</option><option value={90}>90 天</option></select></label>
        <label className="journal-capture-toggle"><input type="checkbox" checked={captureEnabled} onChange={event => setCaptureEnabled(event.target.checked)} />保存前台窗口画面，并在本机识别文字</label>
        <p>只保存当时的前台窗口，不保存整个桌面。窗口内部的隐私字段不会自动遮蔽，请排除相关应用或暂停记录。</p>
        <label>画面间隔<select aria-label="画面间隔" value={captureInterval} onChange={event => setCaptureInterval(Number(event.target.value))}>{[5, 10, 20, 30, 60].map(value => <option key={value} value={value}>{value} 秒{value === 5 ? '（推荐）' : ''}</option>)}</select></label>
        <p>窗口切换后稳定约 1 秒补采；同一窗口按所选间隔采集，相同画面去重。处理较慢时会延后，不叠加任务。</p>
        <label>画面存储上限<select aria-label="画面存储上限" value={storageLimit} onChange={event => setStorageLimit(Number(event.target.value))}>{[256, 512, 1024, 2048].map(value => <option key={value} value={value}>{value >= 1024 ? `${value / 1024} GB` : `${value} MB`}</option>)}</select></label>
        <p>缩短期限会立即清理过期记录。时间为采样估计，不代表实际工作产出。</p>
        <div className="journal-actions"><button className="journal-primary" disabled={busy} onClick={async () => { if (await configure({ excludedApps: excluded.split('\n').map(value => value.trim()).filter(Boolean), retentionDays: retention, captureEnabled, captureIntervalSeconds: captureInterval, maxStorageMB: storageLimit })) setSettings(false) }}>保存设置</button>
        {status?.config.enabled && <button disabled={busy} onClick={() => void configure({ enabled: false })}>关闭记录</button>}</div>
      </div>
    </section></dialog>}

    <div className="journal-workspace"><section className="journal-content" aria-label="活动时间线">
      <JournalDayPanel date={date} revision={revision} onFilter={app => { setQuery(app); setOffset(0); setView('activity'); setActivityMode('raw'); setLoading(true) }} onSettings={openSettings} />
      <nav className="journal-view-nav" aria-label="日志视图">{([['activity', '活动轨迹'], ['captures', '关键画面'], ['summary', '日志总结'], ['ask', '问问这一天'], ['usage', 'AI 用量']] as const).map(([key, label]) => <button key={key} aria-current={view === key ? 'page' : undefined} onClick={() => setView(key)}>{label}</button>)}</nav>
      <div className="journal-filterbar">
        <div className="journal-date"><button aria-label="前一天" onClick={() => shiftDate(-1)}>‹</button><input type="date" aria-label="日志日期" value={date} onChange={event => changeDate(event.target.value)} /><button aria-label="后一天" onClick={() => shiftDate(1)}>›</button><button onClick={() => changeDate(today())}>今天</button></div>
        <details className="journal-more"><summary aria-label="更多日志操作">更多 ···</summary><div><button onClick={event => { setConfirmDelete(true); event.currentTarget.closest('details')!.open = false }} disabled={busy}>删除当天记录</button></div></details>
        {(view === 'activity' || view === 'captures') && <label className="search-field journal-search" data-filled={Boolean(query)}><svg className="search-field-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg><input aria-label="搜索活动" value={query} onChange={event => { setQuery(event.target.value); setOffset(0); setLoading(true) }} placeholder={view === 'captures' ? '搜索画面文字或标题' : activityMode === 'tasks' ? '搜索事项、应用或备注' : '搜索应用或窗口标题'} />{query && <button className="search-field-action" aria-label="清空活动搜索" onClick={() => { setQuery(''); setOffset(0) }}>×</button>}</label>}
      </div>
      {view === 'activity' && <div className="journal-mode-bar"><div className="journal-mode-switch" aria-label="活动展示方式"><button aria-pressed={activityMode === 'tasks'} onClick={() => setActivityMode('tasks')}>事项视图</button><button aria-pressed={activityMode === 'raw'} onClick={() => setActivityMode('raw')}>原始记录</button></div>{activityMode === 'raw' && <span>{page.total} 条 · {duration(page.durationMs)}{query ? '匹配时长' : '记录时长'}</span>}</div>}
      {confirmDelete && <div className="journal-delete" role="alert"><span>删除 {date} 的活动、画面及识别文字？包含与当天重叠的跨日片段，已生成的日志总结也会清空。此操作不可撤销。</span><div><button disabled={busy} onClick={() => setConfirmDelete(false)}>取消</button><button disabled={busy} onClick={() => void deleteDay()}>确认删除</button></div></div>}
      {view === 'usage' && <JournalUsageHistory date={date} revision={revision} />}
      {view === 'captures' && <JournalCaptures date={date} query={query} revision={revision} onOpenSource={setSelectedSource} />}
      {view === 'summary' && <JournalSummaryView date={date} revision={revision} onGenerated={() => setRevision(value => value + 1)} onOpenSource={setSelectedSource} />}
      <div hidden={view !== 'ask'}><JournalAsk key={deletedRevision} date={date} onOpenSource={setSelectedSource} /></div>
      {view === 'activity' && activityMode === 'tasks' && <JournalTasks date={date} query={query} revision={revision} onOpen={setSelectedSource} onOrganize={() => setView('summary')} />}
      {view === 'activity' && activityMode === 'raw' && (loading ? <div className="journal-empty" role="status">正在读取活动…</div> : page.items.length === 0 ? <div className="journal-empty"><h2>{query ? '没有找到匹配的活动' : '这一天还没有记录'}</h2><p>{query ? '试试应用名或窗口标题中的其他文字。' : status?.state === 'paused' ? '记录已暂停，可以在顶栏继续记录。' : status?.state === 'error' ? '采集遇到问题，请查看上方错误提示。' : status?.config.enabled ? '这一天没有保存的活动，试试其他日期。' : '开启记录后，你的应用活动会按时间出现在这里。'}</p></div> : <ol key={`${date}:${query}:${offset}`} className="journal-timeline journal-list-scroll" tabIndex={0} aria-label="原始记录列表">{page.items.map(item => <li key={item.id}>
        <div className="journal-time"><time dateTime={new Date(item.startedAt).toISOString()}>{time(item.startedAt)}</time><span>{time(item.endedAt)}</span></div>
        <article><button className="journal-raw-open" onClick={() => setSelectedSource(`activity:${item.id}`)}><div className="journal-card-heading"><span className="journal-app">{item.app.replace(/\.exe$/i, '')}</span><span>{duration(item.endedAt - item.startedAt)}</span></div><h2>{item.title || '无窗口标题'}</h2><span className="journal-task-open">查看详情 →</span></button></article>
      </li>)}</ol>)}
      {view === 'activity' && activityMode === 'raw' && page.total > 100 && <nav className="journal-pagination" aria-label="活动分页"><button disabled={!offset || loading} onClick={() => { setOffset(value => Math.max(0, value - 100)); setLoading(true) }}>上一页</button><span>第 {Math.floor(offset / 100) + 1} / {Math.ceil(page.total / 100)} 页</span><button disabled={offset + 100 >= page.total || loading} onClick={() => { setOffset(value => value + 100); setLoading(true) }}>下一页</button></nav>}
    </section></div>
    {selectedSource && <JournalDetailPanel key={`${date}:${selectedSource}`} active={active} id={selectedSource} date={date} onClose={() => setSelectedSource('')} onChanged={deleted => { setRevision(value => value + 1); if (deleted) setDeletedRevision(value => value + 1) }} />}
    <footer>本地活动日志 · {status?.lastCapturedAt ? `最近记录 ${time(status.lastCapturedAt)}` : '尚无本次运行的活动记录'}</footer>
  </main>
}
