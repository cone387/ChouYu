import { useEffect, useRef, useState } from 'react'
import type { JournalSemanticPlan, JournalSemanticResult } from '../../../../shared/journal'
import { journalDateKey, journalSearchRange } from '../../core/journal-search'

export function JournalSemantic({ date, onOpen }: { date: string; onOpen(id: string, date: string): void }) {
  const [start, setStart] = useState(date), [end, setEnd] = useState(date), [query, setQuery] = useState(''), [app, setApp] = useState('')
  const [plan, setPlan] = useState<JournalSemanticPlan | null>(null), [result, setResult] = useState<JournalSemanticResult | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false; void window.electronAPI.journal.cancelSemantic().catch(() => {}) } }, [])
  const change = (update: () => void) => { update(); setPlan(null); setResult(null); setError(''); setNotice(''); void window.electronAPI.journal.cancelSemantic().catch(() => {}) }
  const prepare = async () => {
    setBusy(true); setPlan(null); setResult(null); setError('')
    try { const value = await window.electronAPI.journal.prepareSemantic({ ...journalSearchRange(start, end), query, app }); if (alive.current) setPlan(value) }
    catch (reason) { if (alive.current) setError(String(reason)) } finally { if (alive.current) setBusy(false) }
  }
  const search = async () => {
    if (!plan) return
    setBusy(true); setError(''); setResult(null)
    try { const value = await window.electronAPI.journal.searchSemantic(plan.id); if (alive.current) setResult(value) }
    catch (reason) { if (alive.current) setError(String(reason)) } finally { if (alive.current) { setBusy(false); setPlan(null) } }
  }
  return <section className="journal-semantic" aria-label="日志语义查找">
    <h2>按意思找回记录</h2><p>用描述查找相似内容。准备阶段只读取本地记录；确认后才向配置的 Embedding 服务发送文字，可能产生费用。</p>
    <form onSubmit={event => { event.preventDefault(); void prepare() }}>
      <div className="journal-question-range"><label>开始日期<input type="date" aria-label="语义开始日期" disabled={busy} value={start} onChange={event => change(() => setStart(event.target.value))} /></label><label>结束日期<input type="date" aria-label="语义结束日期" disabled={busy} value={end} onChange={event => change(() => setEnd(event.target.value))} /></label></div>
      <label>应用包含<input aria-label="语义应用筛选" disabled={busy} maxLength={120} value={app} onChange={event => change(() => setApp(event.target.value))} placeholder="留空查找所有应用" /></label>
      <label>想找什么<textarea aria-label="语义查找描述" disabled={busy} maxLength={200} value={query} onChange={event => change(() => setQuery(event.target.value))} placeholder="例如：之前讨论接口超时原因的页面" /></label>
      <button disabled={busy || !query.trim()}>准备检索预览</button>
    </form>
    <p>每次最多 31 天、600 条来源、512 个文本块；超出时需缩小范围。未完成 OCR 的画面仅比较标题和应用。已确认检索的来源向量保留在本机，重复查找复用未变化的来源；查询不单独建立持久索引。索引数据最多 64 MiB，旧条目按最近使用情况淘汰。</p>
    <button disabled={busy} onClick={() => { setBusy(true); setPlan(null); setResult(null); setError(''); void window.electronAPI.journal.clearSemanticCache().then(() => { if (alive.current) setNotice('本地语义索引已清空，日志来源保留。') }).catch(reason => { if (alive.current) setError(String(reason)) }).finally(() => { if (alive.current) setBusy(false) }) }}>清空本地语义索引</button>
    {notice && <p role="status">{notice}</p>}
    {plan && <section className="journal-semantic-plan" aria-label="待发送文字预览"><h3>确认本次发送范围</h3><p>{plan.sources} 条来源 · {plan.chunks} 个文本块 · 复用 {plan.cachedTexts} 段本地向量；本次需发送 {plan.texts} 段文字，共 {plan.characters.toLocaleString()} 字符，分 {plan.batches} 批发送。</p><p>服务：{plan.service}<br />模型：{plan.model}</p><p>只发送标题、应用名、OCR 文字和查询，不发送图片。字符数不等于计费 token，费用取决于服务商。</p><button disabled={busy} onClick={() => void search()}>确认发送并查找</button></section>}
    {busy && <p role="status">正在处理，可取消。执行最多等待 5 分钟；取消只停止后续请求，已发送部分仍可能计费。<button onClick={() => void window.electronAPI.journal.cancelSemantic().catch(reason => setError(String(reason)))}>取消语义检索</button></p>}
    {error && <p role="alert" className="journal-error">{error}</p>}
    {result && <section aria-label="语义检索结果">{result.cacheWarning && <p role="alert">{result.cacheWarning}</p>}<p>按 {new Date(result.preparedAt).toLocaleString()} 准备的 {result.sources} 条来源排序，最多展示 20 条。相似度不是事实置信度，可能没有相关答案，请回看原始内容确认。</p>{result.items.map(({ source, score }) => <article className="journal-saved-card" key={source.id}><h3>{source.title || source.app}</h3><p>{journalDateKey(source.at)} · {source.app} · 相似度 {score.toFixed(3)}</p><button onClick={() => onOpen(source.id, journalDateKey(source.at))}>回看原始来源</button></article>)}</section>}
  </section>
}
