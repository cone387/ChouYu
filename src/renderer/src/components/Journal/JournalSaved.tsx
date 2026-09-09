import { useEffect, useRef, useState } from 'react'
import type { JournalSavedItem, JournalSavedUsage } from '../../../../shared/journal'
import { journalRange } from './JournalEvidence'

const yesterday = () => {
  const value = new Date(); value.setDate(value.getDate() - 1)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

export function SavedSource({ item, onRecognized }: { item: JournalSavedItem; onRecognized(): void }) {
  const [image, setImage] = useState(''), [error, setError] = useState('')
  const [capture, setCapture] = useState(item.capture), [recognizing, setRecognizing] = useState(false)
  useEffect(() => {
    let active = true
    if (item.imageBytes) void window.electronAPI.journal.savedImage(item.id).then(value => { if (active) setImage(value) }).catch(reason => { if (active) setError(String(reason)) })
    return () => { active = false }
  }, [item.id, item.imageBytes])
  return <section className="journal-saved-source" aria-label="已保存的来源快照">
    <p>保存时的来源快照；原日志后续变化不会改写这份收藏。</p>
    {error && <p role="alert">{error}</p>}
    {item.imageBytes > 0 && !image && !error && <p role="status">正在读取收藏画面…</p>}
    {image && <img src={image} alt={item.capture?.title || '收藏画面'} />}
    {capture && <><p>{new Date(capture.capturedAt).toLocaleString()} · {capture.app}</p><pre>{capture.ocrText || '尚无可用的识别文字。'}</pre>
      <button disabled={recognizing} onClick={async () => {
        setRecognizing(true); setError('')
        try { setCapture(await window.electronAPI.journal.retrySavedOcr(item.id)); onRecognized() }
        catch (reason) { setError(String(reason)) } finally { setRecognizing(false) }
      }}>{recognizing ? '正在本地识别…' : '本地识别文字'}</button></>}
    {item.activities.map(activity => <p key={activity.id}>{new Date(activity.startedAt).toLocaleString()} · {activity.app} · {activity.title}</p>)}
  </section>
}

export function JournalSaved({ focusId = '' }: { focusId?: string }) {
  const [shortcutEnabled, setShortcutEnabled] = useState(false), [shortcutError, setShortcutError] = useState('')
  const focused = useRef('')
  const [sourceDate, setSourceDate] = useState(yesterday)
  const [generating, setGenerating] = useState(false), [generationNotice, setGenerationNotice] = useState('')
  const [items, setItems] = useState<JournalSavedItem[]>([])
  const [usage, setUsage] = useState<JournalSavedUsage | null>(null)
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('open'), [query, setQuery] = useState(''), [expanded, setExpanded] = useState('')
  const [deleting, setDeleting] = useState(''), [editing, setEditing] = useState(''), [note, setNote] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true)
    void Promise.all([window.electronAPI.journal.savedItems(), window.electronAPI.journal.savedUsage()]).then(([value, capacity]) => { if (active) { setItems(value); setUsage(capacity); setError('') } }).catch(reason => { if (active) { setUsage(null); setError(String(reason)) } }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [revision, focusId])
  useEffect(() => {
    let active = true
    void window.electronAPI.journal.status().then(status => { if (active) { setShortcutEnabled(Boolean(status.config.quickBookmarkEnabled)); setShortcutError(status.quickBookmarkError || '') } }).catch(reason => { if (active) setShortcutError(String(reason)) })
    return () => { active = false }
  }, [revision])
  useEffect(() => {
    const item = items.find(value => value.id === focusId)
    if (!item || focused.current === focusId) return
    focused.current = focusId
    setFilter('all'); setQuery(''); setExpanded(focusId); setEditing(focusId); setNote(item.note)
  }, [items, focusId])
  const run = async (operation: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setError('')
    try { await operation(); setDeleting(''); setEditing(''); setRevision(value => value + 1) }
    catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  const shown = items.filter(item => (filter !== 'open' || !item.completed) && (filter !== 'done' || item.completed) &&
    (filter !== 'bookmark' || item.kind === 'bookmark') && `${item.title}\n${item.note}\n${item.task.text}\n${item.task.nextStep || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt)
  const generate = () => run(async () => {
    setGenerating(true); setGenerationNotice('')
    try {
      const result = await window.electronAPI.journal.generateContinuations(journalRange(sourceDate))
      setGenerationNotice(result.considered ? `新增 ${result.created} 张接续卡，${result.skipped} 张已有卡片保持原状。` : '这一天没有明确的继续入口或待解决事项，可以从活动详情手动留存。')
    } finally { setGenerating(false) }
  })
  return <section className="journal-saved" aria-label="接续卡与书签">
    <div className="journal-saved-heading"><div><h2>接着做</h2><p>跨日期保留你的接续卡与书签。在事项详情中添加。</p></div><button disabled={busy || loading} onClick={() => setRevision(value => value + 1)}>刷新收藏</button></div>
    <section aria-label="收藏容量" className="journal-saved-capacity">
      {loading ? <p role="status">正在读取收藏容量…</p> : usage ? <>
        <p>独立收藏 · {usage.count} / {usage.limits.count} 项 · 画面 {(usage.bytes / 1024 / 1024).toFixed(1)} / {usage.limits.bytes / 1024 / 1024} MB · 文字 {(usage.textBytes / 1024 / 1024).toFixed(2)} / {usage.limits.textBytes / 1024 / 1024} MB</p>
        {(usage.count >= usage.limits.count * .9 || usage.bytes >= usage.limits.bytes * .9 || usage.textBytes >= usage.limits.textBytes * .9) && <p role="status" className="journal-error">收藏接近或已达上限。可切换“全部收藏”查看并删除不再需要的内容；已完成的收藏仍占容量。</p>}
      </> : <p>收藏容量暂时无法读取，请刷新重试。</p>}
      <p>日志到期或删除后仍保留，需在此单独删除。这里显示保存内容的大小；删除会释放可复用空间，磁盘文件不一定立即缩小。</p>
    </section>
    <details className="journal-bookmark-shortcut"><summary>快捷书签 · {shortcutEnabled ? '已开启' : '未开启'}{shortcutError ? ' · 需要处理' : ''}</summary><label><input type="checkbox" checked={shortcutEnabled} disabled={busy} onChange={event => { const enabled = event.target.checked; void run(async () => { const status = await window.electronAPI.journal.configure({ quickBookmarkEnabled: enabled }); setShortcutEnabled(Boolean(status.config.quickBookmarkEnabled)); setShortcutError(status.quickBookmarkError || '') }) }} />开启快捷书签：Ctrl/⌘ + Shift + B</label>
      <p>在目标窗口按下快捷键保存画面，再补备注。仅手动抓取，不开启连续记录；排除应用及锁屏限制仍生效。</p>
      {shortcutError && <p role="alert" className="journal-error">{shortcutError}<button disabled={busy} onClick={() => void run(async () => { const status = await window.electronAPI.journal.configure({ quickBookmarkEnabled: shortcutEnabled }); setShortcutError(status.quickBookmarkError || '') })}>重试快捷键</button></p>}
    </details>
    <section className="journal-continuation-generator" aria-label="生成每日接续卡">
      <div className="journal-actions"><label>来源日期 <input type="date" aria-label="接续卡来源日期" disabled={busy} value={sourceDate} onChange={event => setSourceDate(event.target.value)} /></label>
        <button disabled={busy || loading || !sourceDate} onClick={() => void generate()}>{generating ? '正在生成接续卡…' : '生成接续卡'}</button>
        {generating && <button onClick={() => void window.electronAPI.journal.cancelAnalysis().catch(reason => setError(String(reason)))}>取消生成</button>}
      </div>
      <p>优先使用已有总结；没有总结时，将该日标题和 OCR 文字交给当前模型分析。最多生成 5 张，已有卡片及完成状态保持不变。</p>
      {generationNotice && <p role="status">{generationNotice}</p>}
    </section>
    <div className="journal-saved-filters"><label>显示<select value={filter} onChange={event => setFilter(event.target.value)}><option value="open">待继续</option><option value="bookmark">书签</option><option value="done">已完成</option><option value="all">全部收藏</option></select></label><label>搜索收藏<input value={query} maxLength={200} onChange={event => setQuery(event.target.value)} placeholder="事项或备注" /></label></div>
    {error && <p className="journal-error" role="alert">{error}<button onClick={() => setRevision(value => value + 1)}>重试加载</button></p>}
    {loading ? <p role="status">正在读取收藏…</p> : !shown.length ? <div className="journal-empty"><h3>{items.length ? '没有符合筛选的收藏' : '留下一个下次继续的位置'}</h3><p>{items.length ? '试试其他筛选或搜索词。' : '打开活动事项，添加接续卡；选好画面后，也可以保存书签。'}</p></div> :
      <div className="journal-list-scroll" tabIndex={0} aria-label="收藏列表">{shown.map(item => <article className="journal-saved-card" key={item.id}>
        <div className="journal-saved-heading"><span>{item.kind === 'continuation' ? '接续卡' : '画面书签'}{item.pinned ? ' · 已固定' : ''}{item.completed ? ' · 已完成' : ''}</span><time>{new Date(item.createdAt).toLocaleDateString()}</time></div>
        <h3>{item.title}</h3>{item.task.text && <p>{item.task.text}</p>}
        {item.task.nextStep && <p className="journal-detail-note">建议继续：{item.task.nextStep}（需自行确认）</p>}
        {!item.task.text && <p>仅有活动线索，尚不能判断实际进展。</p>}
        {item.note && <p>我的备注：{item.note}</p>}
        <div className="journal-actions"><button disabled={busy} aria-pressed={item.pinned} onClick={() => void run(() => window.electronAPI.journal.updateSaved({ id: item.id, pinned: !item.pinned }))}>{item.pinned ? '取消固定' : '固定'}</button>
          <button disabled={busy} onClick={() => void run(() => window.electronAPI.journal.updateSaved({ id: item.id, completed: !item.completed }))}>{item.completed ? '重新继续' : '标记完成'}</button>
          <button aria-expanded={expanded === item.id} onClick={() => setExpanded(expanded === item.id ? '' : item.id)}>{expanded === item.id ? '收起来源' : '回看来源快照'}</button>
          <button disabled={busy} onClick={() => { setEditing(item.id); setNote(item.note) }}>编辑备注</button><button disabled={busy} onClick={() => setDeleting(item.id)}>删除收藏</button></div>
        {editing === item.id && <form className="journal-edit-form" onSubmit={event => { event.preventDefault(); void run(() => window.electronAPI.journal.updateSaved({ id: item.id, note })) }}><label>收藏备注<textarea autoFocus aria-label="收藏备注" value={note} maxLength={4000} onChange={event => setNote(event.target.value)} /></label><div className="journal-actions"><button disabled={busy}>保存备注</button><button type="button" disabled={busy} onClick={() => setEditing('')}>取消</button></div></form>}
        {deleting === item.id && <div className="journal-delete" role="alert"><p>删除这份收藏及保存的来源快照？此操作不可撤销，原日志不受影响。</p><button disabled={busy} onClick={() => setDeleting('')}>取消</button><button disabled={busy} onClick={() => void run(() => window.electronAPI.journal.deleteSaved(item.id))}>确认删除收藏</button></div>}
        {expanded === item.id && <SavedSource item={item} onRecognized={() => setRevision(value => value + 1)} />}
      </article>)}</div>}
  </section>
}
