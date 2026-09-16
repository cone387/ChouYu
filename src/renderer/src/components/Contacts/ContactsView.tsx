import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

interface ContactSection {
  letter: string
  items: CharacterStats[]
}

const EMPTY_FORM: FormState = { id: null, name: '', avatar: '', soulMd: '', providerProfileId: DEFAULT_PROFILE_ID, model: '' }

// GB2312 一级汉字按拼音分区的边界字（无 I/U/V 声母），配合 zh 拼音 Collator 推断首字母。
const PINYIN_BOUNDARIES: readonly (readonly [string, string])[] = [
  ['A', '阿'], ['B', '芭'], ['C', '擦'], ['D', '搭'], ['E', '蛾'], ['F', '发'], ['G', '噶'], ['H', '哈'],
  ['J', '击'], ['K', '喀'], ['L', '垃'], ['M', '妈'], ['N', '拿'], ['O', '哦'], ['P', '啪'], ['Q', '期'],
  ['R', '然'], ['S', '撒'], ['T', '塌'], ['W', '挖'], ['X', '希'], ['Y', '压'], ['Z', '匝']
]
const PINYIN_COLLATOR = new Intl.Collator('zh-Hans-CN-u-co-pinyin', { sensitivity: 'base' })

function initialOf(name: string): string {
  const first = Array.from(name.trim())[0] ?? ''
  if (!first) return '#'
  if (/[a-z]/i.test(first)) return first.toUpperCase()
  if (!/[一-鿿]/.test(first)) return '#'
  let current = '#'
  for (const [letter, boundary] of PINYIN_BOUNDARIES) {
    if (PINYIN_COLLATOR.compare(first, boundary) >= 0) current = letter
    else break
  }
  return current
}

function sortByName(a: CharacterStats, b: CharacterStats): number {
  return PINYIN_COLLATOR.compare(a.name, b.name)
}

export default function ContactsView({ active, config, onOpenChat, onDeleted }: ContactsViewProps) {
  const [characters, setCharacters] = useState<CharacterStats[]>([])
  const [profiles, setProfiles] = useState<ResolvedProviderProfile[]>([])
  const [query, setQuery] = useState('')
  const [form, setForm] = useState<FormState | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [modelStatus, setModelStatus] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<CharacterStats | null>(null)
  const [activeLetter, setActiveLetter] = useState('')
  const [letterBubble, setLetterBubble] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const bubbleTimer = useRef<number | undefined>(undefined)

  const refresh = useCallback(() => {
    void window.electronAPI.characters.list().then(setCharacters).catch(() => {})
    void window.electronAPI.providerProfiles.list().then(setProfiles).catch(() => {})
  }, [])

  useEffect(() => {
    if (!active) return
    refresh()
    return window.electronAPI.characters.onChanged(refresh)
  }, [active, refresh])

  useEffect(() => () => window.clearTimeout(bubbleTimer.current), [])

  const searching = query.trim().length > 0
  const filtered = useMemo(() => {
    if (!searching) return characters
    const normalized = query.trim().toLowerCase()
    return characters.filter((character) =>
      character.name.toLowerCase().includes(normalized) || character.model.toLowerCase().includes(normalized))
  }, [characters, query, searching])

  const builtIn = useMemo(() => filtered.filter((character) => character.builtIn), [filtered])
  const custom = useMemo(() => filtered.filter((character) => !character.builtIn), [filtered])

  // 搜索态按微信行为打平展示；默认态按拼音首字母分组，'#' 垫底。
  const sections = useMemo<ContactSection[]>(() => {
    if (searching) return [{ letter: '', items: custom.sort(sortByName) }]
    const grouped = new Map<string, CharacterStats[]>()
    for (const character of custom) {
      const letter = initialOf(character.name)
      const bucket = grouped.get(letter)
      if (bucket) bucket.push(character)
      else grouped.set(letter, [character])
    }
    return [...grouped.entries()]
      .map(([letter, items]) => ({ letter, items: items.sort(sortByName) }))
      .sort((a, b) => (a.letter === '#' ? 1 : b.letter === '#' ? -1 : a.letter.localeCompare(b.letter)))
  }, [custom, searching])
  const letters = useMemo(() => sections.map((section) => section.letter).filter(Boolean), [sections])

  const handleScroll = useCallback(() => {
    const container = scrollRef.current
    if (!container || searching || letters.length === 0) return
    const marker = container.scrollTop + container.clientHeight * 0.25
    let current = letters[0]
    for (const letter of letters) {
      const section = container.querySelector<HTMLElement>(`[data-contacts-section="${letter}"]`)
      if (section && section.offsetTop <= marker) current = letter
    }
    setActiveLetter(current)
  }, [letters, searching])

  const jumpToLetter = useCallback((letter: string) => {
    const container = scrollRef.current
    const section = container?.querySelector<HTMLElement>(`[data-contacts-section="${letter}"]`)
    if (!container || !section) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    container.scrollTo({ top: section.offsetTop - container.offsetTop, behavior: reduced ? 'auto' : 'smooth' })
    setActiveLetter(letter)
    setLetterBubble(letter)
    window.clearTimeout(bubbleTimer.current)
    bubbleTimer.current = window.setTimeout(() => setLetterBubble(''), 600)
  }, [])

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

  const renderRow = (character: CharacterStats) => <li key={character.id} className="contacts-row">
    <button type="button" data-contacts-item={character.id} className="contacts-item"
      onClick={() => onOpenChat(character.id)}>
      <span className={`contacts-avatar${character.builtIn ? ' contacts-avatar-default' : ''}`} aria-hidden="true">{character.avatar}</span>
      <span className="contacts-meta">
        <span className="contacts-name">{character.name}{character.builtIn && <em className="contacts-builtin">内置</em>}</span>
        <span className="contacts-sub">{character.model || '跟随设置页默认模型'} · {character.sessionCount} 个会话</span>
      </span>
      <svg className="contacts-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
    </button>
    <span className="contacts-row-actions">
      <button type="button" data-contacts-edit={character.id} className="contacts-action" aria-label={`编辑 ${character.name}`}
        onClick={() => openForm(character)}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
      </button>
      {!character.builtIn && <button type="button" data-contacts-delete={character.id} className="contacts-action contacts-action-danger"
        aria-label={`删除 ${character.name}`} onClick={() => { setError(''); setConfirmDelete(character) }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
      </button>}
    </span>
  </li>

  return <div className="contacts-view" data-contacts-root>
    <div className="contacts-toolbar">
      <div className="contacts-search-box">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input data-contacts-search className="contacts-search" type="search" placeholder="搜索"
          value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索角色" />
      </div>
      <button type="button" data-contacts-new className="contacts-add" aria-label="新建角色" title="新建角色" onClick={() => openForm()}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      </button>
    </div>
    {error && <div className="contacts-error" role="alert">{error}</div>}
    <div className="contacts-body">
      <div className="contacts-scroll" ref={scrollRef} onScroll={handleScroll}>
        {builtIn.length > 0 && <section className="contacts-section contacts-section-pinned" aria-label="内置角色">
          <ul role="list">{builtIn.map(renderRow)}</ul>
        </section>}
        {sections.map((section) => <section key={section.letter || 'search'} className="contacts-section"
          data-contacts-section={section.letter || undefined}>
          {!searching && <h4 className="contacts-letter" aria-hidden="true">{section.letter}</h4>}
          <ul role="list">{section.items.map(renderRow)}</ul>
        </section>)}
        {filtered.length === 0 && <p className="contacts-empty">没有匹配的角色</p>}
      </div>
      {!searching && letters.length > 0 && <nav className="contacts-index" aria-label="角色字母索引" data-contacts-index>
        {letters.map((letter) => <button key={letter} type="button" className={`contacts-index-item${activeLetter === letter ? ' active' : ''}`}
          data-contacts-index-item={letter} aria-label={`跳转到 ${letter}`} onClick={() => jumpToLetter(letter)}>{letter}</button>)}
      </nav>}
      {letterBubble && <div className="contacts-bubble" role="status" aria-hidden="true">{letterBubble}</div>}
    </div>
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
          <datalist id="contacts-model-options">{models.map((model) => <option key={model} value={model} />)}</datalist>
        </label>
        <button type="button" className="contacts-fetch" data-contacts-fetch-models onClick={() => { void loadModels() }} disabled={busy}>获取模型列表</button>
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
