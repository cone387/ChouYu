import { useEffect, useRef, useState } from 'react'
import type { JournalCapture, JournalCapturePage, JournalSummary } from '../../../../shared/journal'

export function journalRange(date: string) {
  const start = new Date(`${date}T00:00:00`); const end = new Date(start); end.setDate(end.getDate() + 1)
  if (!Number.isFinite(start.getTime())) throw new Error('请选择有效日期。')
  return { from: start.getTime(), to: end.getTime() }
}
const clock = (at: number) => new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

function CaptureImage({ id, title }: { id: string; title: string }) {
  const element = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      void window.electronAPI.journal.image(id).then(value => { if (active) setSrc(value) }).catch(() => { if (active) setFailed(true) })
    })
    if (element.current) observer.observe(element.current)
    return () => { active = false; observer.disconnect() }
  }, [id])
  return <div className="journal-capture-image" ref={element}>{src ? <img src={src} alt={title || '记录的窗口画面'} /> : <span>{failed ? '画面已删除或无法读取' : '正在载入画面…'}</span>}</div>
}

export function CaptureDetail({ id, capture, onClose, onRetry, busy = false, error = '' }: { id: string; capture?: JournalCapture; onClose(): void; onRetry?(): void; busy?: boolean; error?: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close() }, [])
  return <dialog className="journal-detail" ref={dialog} onCancel={onClose}>
    <header><div><strong>{capture?.title || '原始画面'}</strong>{capture && <p>{clock(capture.capturedAt)} · {capture.app}</p>}</div><button autoFocus onClick={onClose} aria-label="关闭画面详情">关闭</button></header>
    <CaptureImage id={id} title={capture?.title || '原始画面'} />
    {busy && <p role="status">正在本机识别文字…</p>}{error && <p role="alert">{error}</p>}
    {capture && <section><h2>识别文字</h2>{capture.ocrStatus === 'failed' ? <p role="alert">{capture.ocrError}<button onClick={onRetry}>重试 OCR</button></p> : capture.ocrStatus === 'pending' ? <p>等待本地 OCR。暂停记录时队列也会暂停，可手动识别这张画面。<button onClick={onRetry}>立即识别</button></p> : <pre>{capture.ocrText || '没有识别到文字。'}</pre>}</section>}
  </dialog>
}

export function JournalCaptures({ date, query, revision }: { date: string; query: string; revision: number }) {
  const [page, setPage] = useState<JournalCapturePage | null>(null)
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<JournalCapture | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setOffset(0); setSelected(null); setPage(null); setError('') }, [date, query])
  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      try {
        void window.electronAPI.journal.captures({ ...journalRange(date), query, offset }).then(result => { if (active) { setPage(result); setError(''); setSelected(previous => previous ? result.items.find(item => item.id === previous.id) || null : null) } }).catch(reason => { if (active) setError(String(reason)) })
      } catch (reason) { setError(String(reason)) }
    }, 200)
    return () => { active = false; clearTimeout(timer) }
  }, [date, query, offset, revision, reload])
  const retry = async () => {
    if (!selected || busy) return
    setBusy(true)
    try { await window.electronAPI.journal.retryOcr(selected.id); setReload(value => value + 1) } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  return <div className="journal-captures">
    <p className="journal-capture-meta">{page ? `${page.total} 张画面 · 全部画面占用 ${(page.storageBytes / 1024 / 1024).toFixed(1)} MB · ${page.pendingOcr} 张等待识别` : '正在读取画面…'}</p>
    {error && <p className="journal-error" role="alert">{error}</p>}
    {page?.items.length === 0 && <div className="journal-empty"><h2>{query ? '没有找到匹配的画面' : '这一天还没有关键画面'}</h2><p>在记录设置中开启前台窗口画面，保存后可按识别文字找回。相同活动中的相同画面只保留一份。</p></div>}
    <div className="journal-capture-grid">{page?.items.map(capture => <button className="journal-capture-card" key={capture.id} onClick={() => setSelected(capture)}>
      <CaptureImage id={capture.id} title={capture.title} /><span>{clock(capture.capturedAt)} · {capture.app.replace(/\.exe$/i, '')}</span><strong>{capture.title || '无窗口标题'}</strong><small>{capture.ocrStatus === 'ready' ? capture.ocrText.slice(0, 90) || '未识别到文字' : capture.ocrStatus === 'failed' ? 'OCR 失败，可打开重试' : '等待识别'}</small>
    </button>)}</div>
    {page && page.total > 30 && <nav className="journal-pagination" aria-label="画面分页"><button disabled={!offset} onClick={() => setOffset(value => Math.max(0, value - 30))}>上一页</button><span>第 {Math.floor(offset / 30) + 1} 页</span><button disabled={offset + 30 >= page.total} onClick={() => setOffset(value => value + 30)}>下一页</button></nav>}
    {selected && <CaptureDetail id={selected.id} capture={selected} busy={busy} error={error} onClose={() => setSelected(null)} onRetry={() => void retry()} />}
  </div>
}

export function JournalSummaryView({ date, revision }: { date: string; revision: number }) {
  const [summary, setSummary] = useState<JournalSummary | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [image, setImage] = useState('')
  const generation = useRef(0)
  useEffect(() => { generation.current++; setSummary(null); setImage(''); setError('') }, [date])
  useEffect(() => {
    if (busy) return
    let active = true
    try { void window.electronAPI.journal.summary(journalRange(date)).then(value => { if (active) setSummary(value) }).catch(reason => { if (active) setError(String(reason)) }) }
    catch (reason) { setError(String(reason)) }
    return () => { active = false }
  }, [date, revision, busy])
  const generate = async () => {
    setBusy(true); setError(''); const current = generation.current
    try { const result = await window.electronAPI.journal.summarize(journalRange(date)); if (generation.current === current) setSummary(result) }
    catch (reason) { if (generation.current === current) setError(String(reason)) }
    finally { setBusy(false) }
  }
  return <section className="journal-ai-summary">
    <div className="journal-summary-intro"><div><h2>{date} 的工作日志</h2><p>使用当前聊天模型整理当天的活动与识别文字。点击生成会将这些文字发送至你配置的 AI 服务，不发送截图。</p></div><button className="journal-primary" disabled={busy} onClick={() => void generate()}>{busy ? '正在整理…' : summary ? '重新生成' : '生成日志总结'}</button></div>
    {error && <p className="journal-error" role="alert">{error}</p>}
    {summary ? <><p>{summary.model} · 生成于 {new Date(summary.createdAt).toLocaleString()} · 基于采样记录，内容可追溯但不代表完整工时或成果。{summary.truncated && '记录较多，本次只分析了部分内容。'}</p>
      <ol className="journal-summary-items">{summary.items.map((item, index) => <li key={index}><p>{item.text}</p><div className="journal-source-links">{item.sourceIds.map(id => {
        const source = summary.sources.find(value => value.id === id)
        return source ? <button key={id} onClick={() => { if (id.startsWith('capture:')) setImage(id.slice(8)); else { const element = document.getElementById(`source-${id}`); const details = element?.closest('details'); if (details) details.open = true; element?.scrollIntoView({ block: 'center' }) } }}>{clock(source.at)} · {id.startsWith('capture:') ? '查看画面' : '活动依据'}</button> : null
      })}</div></li>)}</ol>
      <details className="journal-summary-sources"><summary>查看全部引用依据（{summary.sources.length} 条）</summary>{summary.sources.map(source => <article id={`source-${source.id}`} key={source.id}><strong>{clock(source.at)} · {source.app} · {source.title}</strong><pre>{source.text || '此画面尚无识别文字'}</pre></article>)}</details>
    </> : !busy && <div className="journal-empty"><h2>从活动线索整理一天</h2><p>先积累一些记录，再生成带来源的工作日志。已有结果会保存在本机。</p></div>}
    {image && <CaptureDetail id={image} onClose={() => setImage('')} />}
  </section>
}
