import { JournalUsage } from './JournalUsage'
import { useEffect, useRef, useState } from 'react'
import type { JournalAnswer, JournalCapture, JournalCapturePage, JournalSummary } from '../../../../shared/journal'

export function journalRange(date: string) {
  const start = new Date(`${date}T00:00:00`); const end = new Date(start); end.setDate(end.getDate() + 1)
  if (!Number.isFinite(start.getTime())) throw new Error('请选择有效日期。')
  return { from: start.getTime(), to: end.getTime() }
}
const clock = (at: number) => new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

export function CaptureImage({ id, title }: { id: string; title: string }) {
  const element = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    setSrc(''); setFailed(false)
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

export function JournalCaptures({ date, query, revision, onOpenSource }: { date: string; query: string; revision: number; onOpenSource?(id: string): void }) {
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
    <div className="journal-capture-grid">{page?.items.map(capture => <button className="journal-capture-card" key={capture.id} onClick={() => onOpenSource ? onOpenSource(`capture:${capture.id}`) : setSelected(capture)}>
      <CaptureImage id={capture.id} title={capture.title} /><span>{clock(capture.capturedAt)} · {capture.app.replace(/\.exe$/i, '')}</span><strong>{capture.title || '无窗口标题'}</strong><small>{capture.ocrStatus === 'ready' ? capture.ocrText.slice(0, 90) || '未识别到文字' : capture.ocrStatus === 'failed' ? 'OCR 失败，可打开重试' : '等待识别'}</small>
    </button>)}</div>
    {page && page.total > 30 && <nav className="journal-pagination" aria-label="画面分页"><button disabled={!offset} onClick={() => setOffset(value => Math.max(0, value - 30))}>上一页</button><span>第 {Math.floor(offset / 30) + 1} 页</span><button disabled={offset + 30 >= page.total} onClick={() => setOffset(value => value + 30)}>下一页</button></nav>}
    {selected && <CaptureDetail id={selected.id} capture={selected} busy={busy} error={error} onClose={() => setSelected(null)} onRetry={() => void retry()} />}
  </div>
}

export function JournalSummaryView({ date, revision, onGenerated, onOpenSource }: { date: string; revision: number; onGenerated?(): void; onOpenSource?(id: string): void }) {
  const [summary, setSummary] = useState<JournalSummary | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [image, setImage] = useState('')
  const [copied, setCopied] = useState(false)
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
    setBusy(true); setError(''); setCopied(false); const current = generation.current
    try { const result = await window.electronAPI.journal.summarize(journalRange(date)); if (generation.current === current) { setSummary(result); onGenerated?.() } }
    catch (reason) { if (generation.current === current) setError(String(reason)) }
    finally { setBusy(false) }
  }
  return <section className="journal-ai-summary">
    <div className="journal-summary-intro"><div><h2>这一天，推进了哪些事</h2><p>按事项整理具体进展与继续入口。生成时向当前 AI 服务发送当天标题和识别文字，不发送截图。</p></div><button className="journal-primary" disabled={busy} onClick={() => void generate()}>{busy ? '正在整理事项…' : summary ? '重新生成' : '整理这一天'}</button></div>
    {error && <p className="journal-error" role="alert">{error}</p>}
    {busy && <p role="status">正在归并事项，最长等待 2 分钟。<button onClick={() => void window.electronAPI.journal.cancelAnalysis().catch(reason => setError(String(reason)))}>取消生成</button></p>}
    {summary ? <><div className="journal-summary-meta"><p>{summary.model} · {new Date(summary.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 生成<br /><JournalUsage usage={summary.usage} /></p><button onClick={() => { void navigator.clipboard.writeText(summary.items.map(item => `${item.title || '活动'}${item.category ? ` · ${item.category}` : ''}\n${item.text}${item.note ? `\n备注：${item.note}` : ''}${item.nextStep ? `\n建议继续：${item.nextStep}` : ''}`).join('\n\n')).then(() => setCopied(true)).catch(() => setError('复制失败，请选择文字手动复制。')) }}>{copied ? '已复制' : '复制日志'}</button></div>
      {summary.version !== 2 && <p className="journal-coverage">这是旧版总结，重新生成后可按事项查看具体线索。</p>}
      {summary.coverage && <p className="journal-coverage">分析了 {summary.coverage.analyzed} / {summary.coverage.available} 条来源 · {summary.coverage.ocrSources} 条含正文。{!summary.coverage.ocrSources && '仅有标题线索，无法确认具体修改与完成结果。'}{summary.truncated && '记录已抽样，可能遗漏部分事项。'}</p>}
      <ol className="journal-summary-items">{summary.items.map((item, index) => <li key={index} data-kind={item.kind || 'activity'}>
        <div className="journal-task-heading"><span className="journal-task-kind">{{ activity: '活动线索', progress: '具体进展', blocker: '待解决', decision: '决定' }[item.kind || 'activity']}</span><span>{(() => { const cited = summary.sources.filter(source => item.sourceIds.includes(source.id)); return cited.length ? `${clock(Math.min(...cited.map(source => source.at)))} — ${clock(Math.max(...cited.map(source => source.endedAt ?? source.at)))}` : '' })()}</span></div>
        {item.title && <h3>{item.title}</h3>}{item.edited && <p className="journal-correction-label">已手动修正{item.category ? ` · ${item.category}` : ''}</p>}<p>{item.text}</p>{item.note && <p className="journal-detail-note">备注 · {item.note}</p>}{item.nextStep && <div className="journal-next-step"><strong>建议继续</strong><p>{item.nextStep}</p></div>}<div className="journal-source-links">{item.sourceIds.map(id => {
        const source = summary.sources.find(value => value.id === id)
        return source ? <button key={id} onClick={() => { if (onOpenSource) onOpenSource(id); else if (id.startsWith('capture:')) setImage(id.slice(8)); else { const element = document.getElementById(`source-${id}`); const details = element?.closest('details'); if (details) details.open = true; element?.scrollIntoView({ block: 'center' }) } }}>{clock(source.at)} · {id.startsWith('capture:') ? '查看画面' : '活动依据'}</button> : null
      })}</div></li>)}</ol>
      <details className="journal-summary-sources"><summary>查看全部引用依据（{summary.sources.length} 条）</summary>{summary.sources.map(source => <article id={`source-${source.id}`} key={source.id}><strong>{clock(source.at)} · {source.app} · {source.title}</strong><pre>{source.text || '此画面尚无识别文字'}</pre></article>)}</details>
    </> : !busy && <div className="journal-empty"><h2>从活动线索整理一天</h2><p>先积累一些记录，再生成带来源的工作日志。已有结果会保存在本机。</p></div>}
    {image && <CaptureDetail id={image} onClose={() => setImage('')} />}
  </section>
}

interface AskSession { question: string; answer: JournalAnswer | null; asked: string; busy: boolean; error: string }
const emptyAsk: AskSession = { question: '', answer: null, asked: '', busy: false, error: '' }

export function JournalAsk({ date, onOpenSource }: { date: string; onOpenSource?(id: string): void }) {
  const [sessions, setSessions] = useState<Record<string, AskSession>>({})
  const { question, answer, asked, busy, error } = sessions[date] || emptyAsk
  const update = (patch: Partial<AskSession>) => setSessions(previous => ({ ...previous, [date]: { ...(previous[date] || emptyAsk), ...patch } }))
  const setQuestion = (question: string) => update({ question })
  const setAnswer = (answer: JournalAnswer | null) => update({ answer })
  const setAsked = (asked: string) => update({ asked })
  const setBusy = (busy: boolean) => update({ busy })
  const setError = (error: string) => update({ error })
  const [image, setImage] = useState('')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const ask = async () => {
    if (busy || !question.trim()) return
    setBusy(true); setError(''); setAnswer(null); setAsked(question.trim())
    try { const result = await window.electronAPI.journal.ask({ ...journalRange(date), question: question.trim() }); if (alive.current) setAnswer(result) }
    catch (reason) { if (alive.current) setError(String(reason)) }
    finally { if (alive.current) setBusy(false) }
  }
  return <section className="journal-ask">
    <h2>从这一天的记录里找答案</h2><p>只分析 {date} 的活动和识别文字。提问会将问题及这些文字发送至当前 AI 服务，回答附来源。</p>
    <div className="journal-question-examples">{['有哪些具体文档或报告可以接着看？', '今天遇到了哪些报错？', '有哪些事情还需要确认结果？'].map(value => <button key={value} disabled={busy} onClick={() => setQuestion(value)}>{value}</button>)}</div>
    <form onSubmit={event => { event.preventDefault(); void ask() }}><label htmlFor="journal-question">想找回什么</label><textarea id="journal-question" value={question} maxLength={1000} rows={3} placeholder="例如：下午看的评测报告叫什么？" onChange={event => setQuestion(event.target.value)} /><button className="journal-primary" disabled={busy || !question.trim()}>{busy ? '正在查找依据…' : '查找答案'}</button></form>
    {error && <p role="alert" className="journal-error">{error}</p>}
    {busy && <p role="status">正在整理所选日期的证据，最长等待 2 分钟。<button onClick={() => void window.electronAPI.journal.cancelAnalysis().catch(reason => setError(String(reason)))}>取消查找</button></p>}
    {answer && <article className="journal-answer"><h3>{asked}</h3><p>{answer.text}</p><p>{answer.model}<br /><JournalUsage usage={answer.usage} /></p>{answer.truncated && <p>本次使用抽样记录，未找到的内容可能在未覆盖的片段中。</p>}
      <div className="journal-source-links">{answer.sources.map(source => <button key={source.id} onClick={() => { if (onOpenSource) onOpenSource(source.id); else if (source.id.startsWith('capture:')) setImage(source.id.slice(8)); else { const target = document.getElementById(`answer-${source.id}`); const details = target?.closest('details'); if (details) details.open = true; target?.scrollIntoView({ block: 'nearest' }) } }}>{clock(source.at)} · {source.id.startsWith('capture:') ? '查看画面' : '活动依据'}</button>)}</div>
      {!!answer.sources.length && <details><summary>引用的原始记录</summary>{answer.sources.map(source => <div key={source.id} id={`answer-${source.id}`}><strong>{clock(source.at)} · {source.app}</strong><p>{source.title}</p>{source.text && <pre>{source.text}</pre>}</div>)}</details>}
    </article>}
    {image && <CaptureDetail id={image} onClose={() => setImage('')} />}
  </section>
}
