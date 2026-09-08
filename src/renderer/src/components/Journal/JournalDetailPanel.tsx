import { useEffect, useRef, useState } from 'react'
import type { JournalCapture, JournalDetail } from '../../../../shared/journal'
import { CaptureImage, journalRange } from './JournalEvidence'
import { journalDuration, journalTime, kindLabel } from './JournalTasks'

export function JournalDetailPanel({ id, date, onClose, onChanged, active = true }: { id: string; date: string; active?: boolean; onClose(): void; onChanged(deleted: boolean): void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [detail, setDetail] = useState<JournalDetail | null>(null)
  const [frame, setFrame] = useState<JournalCapture | null>(null)
  const [selected, setSelected] = useState(id.startsWith('capture:') ? id.slice(8) : '')
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(''), [category, setCategory] = useState(''), [note, setNote] = useState('')
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false), [revision, setRevision] = useState(0)
  const [zoom, setZoom] = useState(false)
  const [deleting, setDeleting] = useState<{ type: 'activity' | 'capture'; id: number | string } | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  useEffect(() => {
    const element = dialog.current
    if (active) element?.showModal()
    return () => { element?.close() }
  }, [active])
  useEffect(() => {
    let active = true
    void window.electronAPI.journal.detail({ ...journalRange(date), id }).then(value => {
      if (!active) return
      setDetail(value); setTitle(value.task.title); setCategory(value.task.category); setNote(value.task.note)
      setSelected(previous => value.captures.some(item => item.id === previous) ? previous : value.captures[0]?.id || '')
    }).catch(reason => { if (active) { setDetail(null); setError(String(reason)) } })
    return () => { active = false }
  }, [id, date, revision])
  useEffect(() => {
    let active = true
    setFrame(null); setZoom(false)
    if (selected) void window.electronAPI.journal.captureInfo(selected).then(value => { if (active) setFrame(value) }).catch(reason => { if (active) setError(String(reason)) })
    return () => { active = false }
  }, [selected, revision])
  useEffect(() => { setDeleting(null) }, [selected])
  const frames = detail?.captures || []
  const index = frames.findIndex(item => item.id === selected)
  const navigate = (step: number) => { const next = frames[index + step]; if (next) { setSelected(next.id); setDeleting(null); setError('') } }
  const save = async () => {
    if (!detail || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      await window.electronAPI.journal.editTask({ ...journalRange(date), id: detail.task.id, title, category, note })
      onChanged(false)
      if (alive.current) { setEditing(false); setNotice('修正已保存，原始记录保留。'); setRevision(value => value + 1) }
    } catch (reason) { if (alive.current) setError(String(reason)) } finally { if (alive.current) setBusy(false) }
  }
  const remove = async () => {
    if (!deleting || busy) return
    setBusy(true); setError('')
    try {
      if (deleting.type === 'activity') await window.electronAPI.journal.deleteActivity(Number(deleting.id))
      else await window.electronAPI.journal.deleteCapture(String(deleting.id))
      onChanged(true); onClose()
    } catch (reason) { if (alive.current) { setError(String(reason)); onChanged(true); setRevision(value => value + 1) } }
    finally { if (alive.current) setBusy(false) }
  }
  const retry = async () => {
    if (!selected || busy) return
    setBusy(true); setError('')
    try { await window.electronAPI.journal.retryOcr(selected); if (alive.current) { setRevision(value => value + 1); onChanged(false) } }
    catch (reason) { if (alive.current) setError(String(reason)) } finally { if (alive.current) setBusy(false) }
  }
  return <dialog ref={dialog} className="journal-detail journal-detail-panel" aria-labelledby="journal-detail-title" onCancel={onClose} onKeyDown={event => {
    if ((event.target as HTMLElement).closest('input,textarea,select') || busy) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); navigate(event.key === 'ArrowLeft' ? -1 : 1) }
  }}>
    <header><div><span className="journal-eyebrow">事项详情</span><h2 id="journal-detail-title">{detail?.task.title || '活动与画面'}</h2></div><button autoFocus aria-label="关闭事项详情" onClick={onClose}>关闭</button></header>
    {error && <p role="alert" className="journal-error">{error}{deleting && <button disabled={busy} onClick={() => void remove()}>重试清理</button>}</p>}{notice && <p role="status" className="journal-notice">{notice}</p>}
    {!detail && !error && <p role="status">正在读取活动与画面…</p>}
    {detail && <>
      <div className="journal-detail-meta"><span>{detail.task.category || kindLabel[detail.task.kind]}</span><span>{journalTime(detail.task.startedAt)} — {journalTime(detail.task.endedAt)} · {journalDuration(detail.task.durationMs)} 采样时长</span><button disabled={busy} aria-expanded={editing} onClick={() => setEditing(!editing)}>{editing ? '收起编辑' : '修正事项'}</button></div>
      {editing && <form className="journal-edit-form" onSubmit={event => { event.preventDefault(); void save() }}>
        <label>事项标题<input aria-label="事项标题" value={title} required maxLength={200} onChange={event => setTitle(event.target.value)} /></label>
        <label>分类<input aria-label="事项分类" value={category} maxLength={40} placeholder="例如：开发、阅读、会议" onChange={event => setCategory(event.target.value)} /></label>
        <label>备注<textarea aria-label="事项备注" value={note} maxLength={4000} rows={3} placeholder="补充实际进展或纠正理解" onChange={event => setNote(event.target.value)} /></label>
        <p>修正单独保存在本机；原始标题和识别文字保留。</p><button className="journal-primary" disabled={busy || !title.trim()}>{busy ? '正在保存…' : '保存修正'}</button>
      </form>}
      {detail.task.text && <section className="journal-detail-summary"><h3>相关总结</h3><p>{detail.task.text}</p>{detail.task.nextStep && <p>建议继续：{detail.task.nextStep}</p>}</section>}
      {detail.task.note && <p className="journal-detail-note">备注 · {detail.task.note}</p>}
      <section className="journal-detail-frames" aria-label="关联画面">
        <div className="journal-frame-heading"><h3>关联画面 <small>{frames.length} 张</small></h3>{frames.length > 0 && <div><button aria-label="上一张画面" disabled={index <= 0 || busy} onClick={() => navigate(-1)}>‹</button><span>{index + 1} / {frames.length}</span><button aria-label="下一张画面" disabled={index >= frames.length - 1 || busy} onClick={() => navigate(1)}>›</button><button aria-pressed={zoom} onClick={() => setZoom(!zoom)}>{zoom ? '适应窗口' : '放大画面'}</button></div>}</div>
        {selected ? <>
          <div className={`journal-frame-viewport ${zoom ? 'is-zoomed' : ''}`}><CaptureImage key={selected} id={selected} title={frame?.title || '关联画面'} /></div>
          <label className="journal-frame-scrubber">按时间回看<input type="range" aria-label="画面时间位置" min={0} max={Math.max(0, frames.length - 1)} value={Math.max(0, index)} disabled={frames.length < 2 || busy} onChange={event => setSelected(frames[Number(event.target.value)].id)} /></label>
          <div className="journal-frame-caption"><span>{frame ? `${journalTime(frame.capturedAt)} · ${frame.app.replace(/\.exe$/i, '')}` : '正在读取画面文字…'}</span><button disabled={busy} onClick={() => setDeleting({ type: 'capture', id: selected })}>删除这张画面</button></div>
          {frame && <details className="journal-ocr-text" open><summary>识别文字</summary>{frame.ocrStatus === 'ready' ? <pre>{frame.ocrText || '没有识别到文字。'}</pre> : <p>{frame.ocrStatus === 'failed' ? frame.ocrError || '识别失败' : '等待本地识别'} <button disabled={busy} onClick={() => void retry()}>{busy ? '正在识别…' : frame.ocrStatus === 'failed' ? '重试 OCR' : '立即识别'}</button></p>}</details>}
        </> : <p className="journal-detail-no-frame">此事项没有保存的画面，以下原始活动仍可回看。</p>}
      </section>
      {deleting && <div className="journal-delete" role="alert"><span>{deleting.type === 'activity' ? '删除这条完整活动及关联画面？跨日活动也会一并删除。' : '删除这张画面及识别文字？活动标题仍保留。'} 引用它的修正和可重新生成的总结会清理，此操作不可撤销。</span><div><button disabled={busy} onClick={() => setDeleting(null)}>取消</button><button disabled={busy} onClick={() => void remove()}>确认删除</button></div></div>}
      <section className="journal-detail-activities"><h3>原始活动 <small>{detail.activities.length} 条</small></h3>{detail.activities.map(activity => <article key={activity.id} data-source-id={`activity:${activity.id}`} className={id === `activity:${activity.id}` ? 'is-selected-source' : ''}>
        <div><time>{journalTime(activity.startedAt)} — {journalTime(activity.endedAt)}</time><span>{activity.app.replace(/\.exe$/i, '')}</span></div><p>{activity.title || '无窗口标题'}</p>
        <div><button disabled={!frames.some(item => item.activityId === activity.id)} onClick={() => { setSelected(frames.find(item => item.activityId === activity.id)!.id); dialog.current?.querySelector('.journal-detail-frames')?.scrollIntoView({ block: 'start' }) }}>查看关联画面</button><button disabled={busy} onClick={() => { setDeleting({ type: 'activity', id: activity.id }); setTimeout(() => dialog.current?.querySelector('.journal-delete')?.scrollIntoView({ block: 'center' }), 0) }}>删除这条活动</button></div>
      </article>)}</section>
    </>}
  </dialog>
}
