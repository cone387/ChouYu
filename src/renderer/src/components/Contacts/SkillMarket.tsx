import { useEffect, useId, useState } from 'react'
import type { SkillCatalogItem, SkillCatalogPage, SkillCatalogQuery, SkillCategory } from '../../../../shared/skills'

const sorts = [{ value: 'score', label: '综合评分' }, { value: 'downloads', label: '下载量' }, { value: 'updated_at', label: '最近上新' }] as const
const number = (value: number) => new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
const errorText = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '技能目录加载失败，请重试。'

function SkillIcon({ skill, index }: { skill: SkillCatalogItem; index: number }) {
  const [failedUrl, setFailedUrl] = useState<string>()
  return <span className={`skill-catalog-icon skill-icon-${index % 4}`} aria-hidden="true">
    {skill.iconUrl && failedUrl !== skill.iconUrl
      ? <img src={skill.iconUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedUrl(skill.iconUrl)} />
      : Array.from(skill.name)[0]}
  </span>
}

export default function SkillMarket({ installed, busy, refreshKey, onSelect }: { installed: Set<string>; busy: boolean; refreshKey: number; onSelect: (skill: SkillCatalogItem) => void }) {
  const [query, setQuery] = useState<SkillCatalogQuery>({ page: 1, sortBy: 'score' })
  const [draft, setDraft] = useState(''), [layout, setLayout] = useState<'list' | 'grid'>('list')
  const [data, setData] = useState<SkillCatalogPage>(), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [categories, setCategories] = useState<SkillCategory[]>([]), [categoryError, setCategoryError] = useState(''), [retry, setRetry] = useState(0)
  const searchId = useId()
  useEffect(() => {
    let alive = true
    setLoading(true); setError(''); setData(undefined)
    void window.electronAPI.skills.browse(query).then(result => { if (alive) setData(result) })
      .catch(error => { if (alive) setError(errorText(error)) }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [query, retry, refreshKey])
  useEffect(() => {
    let alive = true
    setCategoryError('')
    void window.electronAPI.skills.categories().then(result => { if (alive) setCategories(result) }).catch(() => { if (alive) setCategoryError('分类暂时无法加载，仍可浏览全部技能。') })
    return () => { alive = false }
  }, [retry, refreshKey])
  const filter = (change: Partial<SkillCatalogQuery>) => setQuery(current => ({ ...current, ...change, page: 1 }))
  return <div className="skill-market" data-skill-catalog>
    <div className="skill-catalog-toolbar">
      <div className="skill-sort" aria-label="技能排序">{sorts.map(sort => <button key={sort.value} type="button" data-skill-sort={sort.value} aria-pressed={query.sortBy === sort.value} onClick={() => filter({ sortBy: sort.value })}>{sort.label}</button>)}</div>
      <div className="skill-layout" aria-label="展示方式">{(['list', 'grid'] as const).map(value => <button type="button" key={value} data-skill-layout={value} aria-pressed={layout === value} onClick={() => setLayout(value)}>{value === 'list' ? '列表' : '卡片'}</button>)}</div>
    </div>
    <div className="skill-catalog-filters">
      <form className="skill-catalog-search" onSubmit={event => { event.preventDefault(); filter({ keyword: draft.trim() }) }}>
        <label className="skill-visually-hidden" htmlFor={searchId}>搜索技能</label>
        <input id={searchId} data-skill-query value={draft} onChange={event => setDraft(event.target.value)} placeholder="搜索技能名称、描述或关键词…" maxLength={200} />
        {draft && <button type="button" aria-label="清空搜索" onClick={() => { setDraft(''); filter({ keyword: '' }) }}>清空</button>}
        <button type="submit">搜索</button>
      </form>
      <select aria-label="技能来源" value={query.source || 'all'} onChange={event => filter({ source: event.target.value as SkillCatalogQuery['source'] })}><option value="all">所有来源</option><option value="community">SkillHub</option><option value="clawhub">ClawHub</option></select>
      <select aria-label="技能分类" value={query.category || ''} onChange={event => filter({ category: event.target.value })}><option value="">所有场景分类</option>{categories.map(category => <option key={category.key} value={category.key}>{category.name}</option>)}</select>
    </div>
    {categoryError && <p className="agent-caption">{categoryError} <button type="button" onClick={() => setRetry(value => value + 1)}>重试</button></p>}
    {loading && <div className="skill-catalog-loading" role="status">正在加载技能…</div>}
    {error && <div className="skill-catalog-failure" role="alert"><p>{error}</p><button type="button" data-skill-retry onClick={() => setRetry(value => value + 1)}>重新加载</button></div>}
    {data && <>
      <div className="skill-catalog-count">共 {data.total.toLocaleString('zh-CN')} 项技能<span>{sorts.find(sort => sort.value === query.sortBy)?.label}排序</span></div>
      {!data.skills.length && <p className="skill-empty">没有匹配的技能，试试其他关键词或分类。</p>}
      <ul className="skill-catalog-results" data-layout={layout}>{data.skills.map((skill, index) => <li key={skill.id} data-catalog-skill={skill.id}>
        <SkillIcon skill={skill} index={index} />
        <div className="skill-catalog-copy"><div className="skill-catalog-title"><button type="button" data-skill-preview disabled={busy} onClick={() => onSelect(skill)}>{skill.name}</button>
          {categories.find(category => category.key === skill.category) && <span className="skill-category">{categories.find(category => category.key === skill.category)!.name}</span>}
          {skill.requiresApiKey && <span className="skill-category">需要 API Key</span>}{skill.paid && <span className="skill-category">付费</span>}</div>
          <p title={skill.description}>{skill.description || '未提供简介。'}</p>
          <div className="skill-catalog-meta">{skill.stars !== undefined && <span title="收藏量">☆ {number(skill.stars)}</span>}{skill.downloads !== undefined && <span title="下载量">↓ {number(skill.downloads)}</span>}<span>{skill.source === 'clawhub' ? 'ClawHub' : 'SkillHub'}</span></div>
        </div>
        <button type="button" className="skill-catalog-install" disabled={busy || installed.has(skill.id)} onClick={() => onSelect(skill)}>{installed.has(skill.id) ? '已安装' : '查看与安装'}</button>
      </li>)}</ul>
      <nav className="skill-pagination" aria-label="技能分页"><span>第 {query.page} / {Math.max(1, Math.ceil(data.total / 24))} 页</span><button type="button" data-skill-page="previous" disabled={query.page === 1} onClick={() => setQuery(current => ({ ...current, page: current.page! - 1 }))}>上一页</button><button type="button" data-skill-page="next" disabled={query.page! * 24 >= data.total} onClick={() => setQuery(current => ({ ...current, page: current.page! + 1 }))}>下一页</button></nav>
    </>}
  </div>
}
