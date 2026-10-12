import { useEffect, useRef, useState } from 'react'
import type { AgentTopic } from '../../../../shared/agents'
import type { DeliveryRef, PortfolioItem, PortfolioQuery, TextAnchor } from '../../../../shared/contact-content'
import ContactDeliveryReader from './ContactDeliveryReader'
import './ContactPortfolio.css'

export default function ContactPortfolio({ characterId, onOpen, initialRef, initialAnchor }: {
  characterId: string; onOpen?: (ref: DeliveryRef) => void; initialRef?: DeliveryRef; initialAnchor?: TextAnchor
}) {
  const [query, setQuery] = useState<PortfolioQuery>({ sort: 'updated' }), [search, setSearch] = useState('')
  const [items, setItems] = useState<PortfolioItem[]>([]), [topics, setTopics] = useState<AgentTopic[]>([])
  const [cursor, setCursor] = useState<string | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false)
  const [opened, setOpened] = useState<DeliveryRef | null>(initialRef ?? null)
  const generation = useRef(0), list = useRef<HTMLElement>(null), returnButton = useRef<HTMLButtonElement | null>(null)
  const load = async (next?: string) => {
    const request = ++generation.current
    setLoading(true); setError('')
    try {
      const [page, work] = await Promise.all([window.electronAPI.agents.portfolio(characterId, { ...query, ...(next ? { cursor: next } : {}) }), window.electronAPI.agents.get(characterId)])
      if (request !== generation.current) return
      setTopics(work.topics); setItems(old => next ? [...old, ...page.items] : page.items); setCursor(page.nextCursor)
    } catch (e) { if (request === generation.current) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (request === generation.current) setLoading(false) }
  }
  useEffect(() => { setItems([]); setCursor(null); void load(); return () => { generation.current++ } }, [characterId, query])
  useEffect(() => { setOpened(initialRef ?? null) }, [characterId, initialRef])
  useEffect(() => {
    let alive = true, request = 0
    const update = async () => { const n = ++request; try { const data = await window.electronAPI.agents.get(characterId); if (alive && n === request) setTopics(data.topics) } catch (e) { if (alive && n === request) setError(String(e)) } }
    const dispose = window.electronAPI.agents.onChanged(id => { if (id === characterId) void update() })
    const timer = setInterval(update, 5000)
    return () => { alive = false; dispose(); clearInterval(timer) }
  }, [characterId])
  const topic = topics.find(t => t.id === opened?.topicId)
  return <section className="contact-portfolio" data-contact-portfolio={characterId} aria-label="成果集">
    <section ref={list} hidden={Boolean(opened)}>
      <div className="topic-heading"><h4>成果集</h4><span className="agent-caption">已正式保存的作品</span></div>
      <form className="portfolio-filters" onSubmit={e => { e.preventDefault(); setQuery(q => ({ ...q, query: search })) }}>
        <label>搜索正文<input data-portfolio-search type="search" value={search} maxLength={1000} onChange={e => setSearch(e.target.value)} placeholder="标题或正文中的文字" /></label>
        <button type="submit" disabled={loading}>搜索</button>
        <label>任务<select value={query.topicId ?? ''} onChange={e => setQuery(q => ({ ...q, topicId: e.target.value || undefined }))}><option value="">全部任务</option>{topics.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
        <label>排序<select value={query.sort} onChange={e => setQuery(q => ({ ...q, sort: e.target.value as PortfolioQuery['sort'] }))}><option value="updated">最近更新</option><option value="name">名称</option></select></label>
        <label className="portfolio-favorite-filter"><input type="checkbox" checked={query.favoritesOnly ?? false} onChange={e => setQuery(q => ({ ...q, favoritesOnly: e.target.checked }))} />只看收藏</label>
      </form>
      <ol className="portfolio-list">{items.map(item => <li key={item.ref.topicId} data-portfolio-item={item.ref.topicId}>
        <button type="button" className="portfolio-open" onClick={event => { returnButton.current = event.currentTarget; setOpened(item.ref); onOpen?.(item.ref) }}>
          <strong>{item.title}</strong><span>{item.excerpt}</span><small>版本 {item.ref.version} · {item.sections.length} 节 · {new Date(item.createdAt).toLocaleString()}</small>
        </button>
        <div className="portfolio-item-footer"><span className="agent-caption">{item.sections.filter(s => s.readHash === s.textHash).length} 节已读{item.sections.some(s => s.readHash && s.readHash !== s.textHash) ? ' · 有内容更新' : ''}</span>
          <button type="button" data-portfolio-favorite aria-pressed={item.favorite} aria-label={`${item.favorite ? '取消收藏' : '收藏'}：${item.title}`} onClick={async () => {
            const request = generation.current
            try { await window.electronAPI.agents.setDeliveryFavorite(characterId, item.ref.topicId, !item.favorite); if (request === generation.current) setItems(rows => rows.map(row => row.ref.topicId === item.ref.topicId ? { ...row, favorite: !item.favorite } : row)) }
            catch (e) { if (request === generation.current) setError(String(e)) }
          }}>{item.favorite ? '已收藏' : '收藏'}</button>
        </div>
      </li>)}</ol>
      {!loading && !error && !items.length && <p className="agent-empty">{query.query || query.favoritesOnly ? '没有符合条件的成果。' : '还没有正式成果。联系人保存正文后，会在这里出现。'}</p>}
      {cursor && <button type="button" disabled={loading} onClick={() => void load(cursor)}>加载更多</button>}
    </section>
    {opened && <><button type="button" data-portfolio-back onClick={() => { setOpened(null); requestAnimationFrame(() => returnButton.current?.focus({ preventScroll: true })) }}>← 返回成果集</button>
      {topic && <ContactDeliveryReader key={`${characterId}:${opened.topicId}:${opened.version}`} characterId={characterId} topic={topic} initialRef={opened} initialAnchor={initialAnchor} />}
      {!loading && !topic && <p role="alert">任务已删除或无法读取，不能打开此成果。</p>}
    </>}
    {loading && <p role="status">正在读取成果…</p>}
    {error && <p role="alert">{error}<button type="button" onClick={() => void load()}>重新读取</button></p>}
  </section>
}
