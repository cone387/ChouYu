import { useCallback, useEffect, useMemo, useState } from 'react'
import { DEFAULT_CHARACTER_ID, type CharacterStats } from '../../../../shared/characters'
import { DEFAULT_PROFILE_ID, type AppConfig, type ResolvedProviderProfile } from '../../../../shared/config'
import type { SessionWorkspace } from '../../shared/types'
import './Contacts.css'

interface ContactsViewProps {
  active: boolean
  config: AppConfig
  onOpenChat: (characterId: string) => void
  onDeleted: (workspace: SessionWorkspace) => void
}

interface FormState {
  id: string | null
  name: string
  avatar: string
  soulMd: string
  providerProfileId: string
  model: string
}

type CategoryFilter = 'all' | 'builtIn' | 'custom'
type SortKey = 'pinyin' | 'popular' | 'recent'

const EMPTY_FORM: FormState = { id: null, name: '', avatar: '', soulMd: '', providerProfileId: DEFAULT_PROFILE_ID, model: '' }

const PINYIN_COLLATOR = new Intl.Collator('zh-Hans-CN-u-co-pinyin', { sensitivity: 'base' })

function sortByName(a: CharacterStats, b: CharacterStats): number {
  return PINYIN_COLLATOR.compare(a.name, b.name)
}

function compareBySort(a: CharacterStats, b: CharacterStats, key: SortKey): number {
  if (key === 'popular') return b.sessionCount - a.sessionCount || sortByName(a, b)
  if (key === 'recent') return (b.lastActiveAt || 0) - (a.lastActiveAt || 0) || sortByName(a, b)
  return sortByName(a, b)
}

function summarizeSoulMd(soulMd: string): string {
  return soulMd.replace(/^#{1,6}\s*/gm, '').replace(/\*\*/g, '').trim()
}

const CATEGORY_OPTIONS: readonly { value: CategoryFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'builtIn', label: '内置' },
  { value: 'custom', label: '自定义' }
]

const SORT_OPTIONS: readonly { value: SortKey; label: string }[] = [
  { value: 'pinyin', label: '拼音' },
  { value: 'popular', label: '最热' },
  { value: 'recent', label: '最新' }
]

export default function ContactsView({ active, config, onOpenChat, onDeleted }: ContactsViewProps) {
  const [characters, setCharacters] = useState<CharacterStats[]>([])
  const [profiles, setProfiles] = useState<ResolvedProviderProfile[]>([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [modelFilter, setModelFilter] = useState('all')
  const [sort, setSort] = useState<SortKey>('pinyin')
  const [detail, setDetail] = useState<CharacterStats | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [modelStatus, setModelStatus] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<CharacterStats | null>(null)

  const refresh = useCallback(() => {
    void window.electronAPI.characters.list().then(setCharacters).catch(() => {})
    void window.electronAPI.providerProfiles.list().then(setProfiles).catch(() => {})
  }, [])

  useEffect(() => {
    if (!active) return
    refresh()
    return window.electronAPI.characters.onChanged(refresh)
  }, [active, refresh])

  const distinctModels = useMemo(
    () => [...new Set(characters.map((character) => character.model).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b)),
    [characters])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return characters
      .filter((character) => category === 'all'
        || (category === 'builtIn' ? character.builtIn : !character.builtIn))
      .filter((character) => modelFilter === 'all' || character.model === modelFilter)
      .filter((character) => !normalized
        || character.name.toLowerCase().includes(normalized)
        || character.model.toLowerCase().includes(normalized))
      .sort((a, b) => compareBySort(a, b, sort))
  }, [characters, query, category, modelFilter, sort])

  const profileNameOf = useCallback((character: CharacterStats): string => {
    const id = character.builtIn ? DEFAULT_PROFILE_ID : character.providerProfileId
    const profile = profiles.find((item) => item.id === id)
    if (!profile) return id
    return profile.builtIn ? `${profile.name}（设置页默认）` : profile.name
  }, [profiles])

  const openForm = useCallback((character?: CharacterStats) => {
    setError('')
    setModels([])
    setModelStatus('')
    if (!character) {
      setForm({ ...EMPTY_FORM, providerProfileId: profiles[0]?.id ?? DEFAULT_PROFILE_ID })
      return
    }
    setForm({
      id: character.id,
      name: character.name,
      avatar: character.avatar,
      soulMd: character.builtIn ? config.soulMd : character.soulMd,
      providerProfileId: character.builtIn ? DEFAULT_PROFILE_ID : character.providerProfileId,
      model: character.builtIn ? config.model : character.model
    })
  }, [profiles, config])

  const loadModels = useCallback(async () => {
    if (!form) return
    setBusy(true)
    setModelStatus('正在获取模型列表…')
    try {
      const result = await window.electronAPI.characters.fetchModels(form.providerProfileId)
      setModels(result.models)
      setModelStatus(result.ok ? `获取到 ${result.models.length} 个模型` : result.message)
    } catch (loadError) {
      setModels([])
      setModelStatus(loadError instanceof Error ? loadError.message : '获取模型列表失败。')
    } finally {
      setBusy(false)
    }
  }, [form])

  const saveForm = useCallback(async () => {
    if (!form) return
    setBusy(true)
    setError('')
    try {
      if (form.id) await window.electronAPI.characters.update(form.id, form)
      else await window.electronAPI.characters.create(form)
      setForm(null)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败，请重试。')
    } finally {
      setBusy(false)
    }
  }, [form])

  const deleteCharacter = useCallback(async () => {
    if (!confirmDelete) return
    setBusy(true)
    try {
      const workspace = await window.electronAPI.characters.remove(confirmDelete.id)
      onDeleted(workspace)
      setConfirmDelete(null)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除失败，请重试。')
    } finally {
      setBusy(false)
    }
  }, [confirmDelete, onDeleted])

  // 捕获阶段拦截 Escape，避免冒泡到 ChatPanel 把整个面板收起。
  useEffect(() => {
    if (!detail && !form && !confirmDelete) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (form) setForm(null)
      else if (confirmDelete) setConfirmDelete(null)
      else setDetail(null)
    }
    window.addEventListener('keydown', closeOnEscape, true)
    return () => window.removeEventListener('keydown', closeOnEscape, true)
  }, [detail, form, confirmDelete])

  return <div className="contacts-view" data-contacts-root>
    <div className="contacts-toolbar">
      <div className="contacts-search-box">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input data-contacts-search className="contacts-search" type="search" placeholder="搜索"
          value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索角色" />
      </div>
      <div className="contacts-sort" data-contacts-sort role="group" aria-label="排序方式">
        {SORT_OPTIONS.map((option) => <button key={option.value} type="button"
          className="contacts-sort-option" aria-pressed={sort === option.value}
          onClick={() => setSort(option.value)}>{option.label}</button>)}
      </div>
      <button type="button" data-contacts-new className="contacts-new" onClick={() => openForm()}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        <span>新建</span>
      </button>
    </div>
    <div className="contacts-tabs">
      <div className="contacts-tab-list" data-contacts-filter-category role="group" aria-label="按分类筛选">
        {CATEGORY_OPTIONS.map((option) => <button key={option.value} type="button"
          className="contacts-tab" aria-pressed={category === option.value}
          onClick={() => setCategory(option.value)}>{option.label}</button>)}
      </div>
      {distinctModels.length > 0 && <div className="contacts-tab-models" data-contacts-filter-model role="group" aria-label="按模型筛选">
        <button type="button" className="contacts-chip" aria-pressed={modelFilter === 'all'}
          onClick={() => setModelFilter('all')}>全部模型</button>
        {distinctModels.map((model) => <button key={model} type="button" className="contacts-chip"
          aria-pressed={modelFilter === model} onClick={() => setModelFilter(model)}>{model}</button>)}
      </div>}
    </div>
    {error && <div className="contacts-error" role="alert">{error}</div>}
    <div className="contacts-scroll">
      <div className="contacts-grid">
        {filtered.map((character) => {
          const model = character.builtIn ? config.model : character.model
          const soulSummary = summarizeSoulMd(character.builtIn ? config.soulMd : character.soulMd)
          return <button key={character.id} type="button" data-contacts-item={character.id}
            className="contacts-card" onClick={() => setDetail(character)}>
            <span className="contacts-card-head">
              <span className={`contacts-card-avatar${character.builtIn ? ' contacts-card-avatar-default' : ''}`} aria-hidden="true">{character.avatar}</span>
              <span className="contacts-card-title">
                <span className="contacts-card-name">{character.name}{character.builtIn && <em className="contacts-builtin">内置</em>}</span>
                <span className="contacts-card-subtitle">{model}</span>
              </span>
            </span>
            <span className="contacts-card-desc">{soulSummary || '未设置人设，使用默认丑鱼人格'}</span>
            <span className="contacts-card-tags">
              <span className="contacts-card-tag">{profileNameOf(character)}</span>
              <span className="contacts-card-tag">{character.sessionCount} 个会话</span>
            </span>
          </button>
        })}
      </div>
      {filtered.length === 0 && <p className="contacts-empty">没有匹配的角色</p>}
    </div>
    {detail && <div className="contacts-scrim" role="presentation">
      <div className="contacts-detail" role="dialog" aria-modal="true" aria-label={`角色详情 ${detail.name}`}
        data-contacts-detail={detail.id}>
        <div className="contacts-detail-head">
          <span className={`contacts-detail-avatar${detail.builtIn ? ' contacts-detail-avatar-default' : ''}`} aria-hidden="true">{detail.avatar}</span>
          <div>
            <p className="contacts-detail-title">{detail.name}{detail.builtIn && <em className="contacts-builtin">内置</em>}</p>
            <p className="contacts-detail-subtitle">{detail.builtIn ? '内置角色' : '自定义角色'}</p>
          </div>
        </div>
        <div className="contacts-detail-fields">
          <label className="contacts-field"><span className="contacts-field-name">模型</span>
            <span className="contacts-detail-value">{detail.builtIn ? config.model : detail.model}</span></label>
          <label className="contacts-field"><span className="contacts-field-name">档案</span>
            <span className="contacts-detail-value">{profileNameOf(detail)}</span></label>
          <label className="contacts-field"><span className="contacts-field-name">会话</span>
            <span className="contacts-detail-value">{detail.sessionCount} 个</span></label>
          <label className="contacts-field"><span className="contacts-field-name">最近活跃</span>
            <span className="contacts-detail-value">{detail.lastActiveAt ? new Date(detail.lastActiveAt).toLocaleString() : '—'}</span></label>
        </div>
        <p className="contacts-detail-soul-title">人设</p>
        <div className="contacts-detail-soul">{(detail.builtIn ? config.soulMd : detail.soulMd) || '（未设置，使用默认丑鱼人格）'}</div>
        <div className="contacts-detail-actions">
          <button type="button" className="primary" data-contacts-start-chat={detail.id}
            onClick={() => { onOpenChat(detail.id); setDetail(null) }}>开始对话</button>
          <button type="button" data-contacts-edit={detail.id} onClick={() => { setDetail(null); openForm(detail) }}>编辑</button>
          {!detail.builtIn && <button type="button" className="danger" data-contacts-delete={detail.id}
            onClick={() => { setDetail(null); setError(''); setConfirmDelete(detail) }}>删除</button>}
        </div>
      </div>
    </div>}
    {confirmDelete && <div className="contacts-scrim" role="presentation">
      <div className="contacts-confirm" role="alertdialog" aria-modal="true" aria-label="删除角色确认">
        <p className="contacts-confirm-title">删除角色</p>
        <p>删除「{confirmDelete.name}」将同时删除它的 {confirmDelete.sessionCount} 个会话，无法恢复。</p>
        <div className="contacts-confirm-actions">
          <button type="button" autoFocus onClick={() => setConfirmDelete(null)}>取消</button>
          <button type="button" className="danger" data-contacts-confirm-delete disabled={busy} onClick={() => { void deleteCharacter() }}>删除</button>
        </div>
      </div>
    </div>}
    {form && <div className="contacts-scrim" role="presentation">
      <form className="contacts-form" data-contacts-form onSubmit={(event) => { event.preventDefault(); void saveForm() }}>
        <h3>{form.id ? '编辑角色' : '新建角色'}</h3>
        <label className="contacts-field"><span className="contacts-field-name">名字</span>
          <input data-contacts-name value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required maxLength={24} /></label>
        <label className="contacts-field"><span className="contacts-field-name">头像</span>
          <input data-contacts-avatar value={form.avatar} onChange={(event) => setForm({ ...form, avatar: event.target.value })} maxLength={8} placeholder="emoji 或单字，留空取首字" /></label>
        <label className="contacts-field"><span className="contacts-field-name">档案</span>
          <select data-contacts-profile value={form.providerProfileId} disabled={form.id === DEFAULT_CHARACTER_ID}
            onChange={(event) => setForm({ ...form, providerProfileId: event.target.value })}>
            {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.builtIn ? '（设置页默认）' : ''}</option>)}
          </select></label>
        <label className="contacts-field"><span className="contacts-field-name">模型</span>
          <input data-contacts-model value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} required list="contacts-model-options" />
          <button type="button" className="contacts-fetch" data-contacts-fetch-models onClick={() => { void loadModels() }} disabled={busy}>获取模型</button>
          <datalist id="contacts-model-options">{models.map((model) => <option key={model} value={model} />)}</datalist>
        </label>
        {modelStatus && <p className="contacts-hint" role="status">{modelStatus}</p>}
        {form.id === DEFAULT_CHARACTER_ID && <p className="contacts-hint">内置角色的人设与模型会写回设置页的全局配置。</p>}
        <label className="contacts-field contacts-field-multiline"><span className="contacts-field-name">人设</span>
          <textarea data-contacts-soulmd rows={6} value={form.soulMd}
            onChange={(event) => setForm({ ...form, soulMd: event.target.value })} placeholder="系统提示词，留空使用默认丑鱼人格" /></label>
        <div className="contacts-form-actions">
          <button type="button" onClick={() => setForm(null)}>取消</button>
          <button type="submit" className="primary" data-contacts-save disabled={busy}>保存</button>
        </div>
      </form>
    </div>}
  </div>
}
