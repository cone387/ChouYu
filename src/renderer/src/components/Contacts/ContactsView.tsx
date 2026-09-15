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

const EMPTY_FORM: FormState = { id: null, name: '', avatar: '', soulMd: '', providerProfileId: DEFAULT_PROFILE_ID, model: '' }

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

  const refresh = useCallback(() => {
    void window.electronAPI.characters.list().then(setCharacters).catch(() => {})
    void window.electronAPI.providerProfiles.list().then(setProfiles).catch(() => {})
  }, [])

  useEffect(() => {
    if (!active) return
    refresh()
    return window.electronAPI.characters.onChanged(refresh)
  }, [active, refresh])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return characters
    return characters.filter((character) =>
      character.name.toLowerCase().includes(normalized) || character.model.toLowerCase().includes(normalized))
  }, [characters, query])

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

  return <div className="contacts-view" data-contacts-root>
    <div className="contacts-toolbar">
      <input data-contacts-search className="contacts-search" type="search" placeholder="搜索角色或模型"
        value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索角色" />
      <button type="button" data-contacts-new className="contacts-new" onClick={() => openForm()}>新建角色</button>
    </div>
    {error && <div className="contacts-error" role="alert">{error}</div>}
    <ul className="contacts-list" role="list">
      {filtered.map((character) => <li key={character.id}>
        <button type="button" data-contacts-item={character.id} className="contacts-item"
          onClick={() => onOpenChat(character.id)}>
          <span className="contacts-avatar" aria-hidden="true">{character.avatar}</span>
          <span className="contacts-meta">
            <span className="contacts-name">{character.name}{character.builtIn && <em className="contacts-builtin">内置</em>}</span>
            <span className="contacts-sub">{character.model || '跟随设置页默认模型'} · {character.sessionCount} 个会话</span>
          </span>
        </button>
        <button type="button" data-contacts-edit={character.id} className="contacts-edit" aria-label={`编辑 ${character.name}`}
          onClick={() => openForm(character)}>编辑</button>
        {!character.builtIn && <button type="button" data-contacts-delete={character.id} className="contacts-delete"
          aria-label={`删除 ${character.name}`} onClick={() => { setError(''); setConfirmDelete(character) }}>删除</button>}
      </li>)}
      {filtered.length === 0 && <li className="contacts-empty">没有匹配的角色</li>}
    </ul>
    {confirmDelete && <div className="contacts-confirm" role="alertdialog" aria-label="删除角色确认">
      <p>删除角色「{confirmDelete.name}」将同时删除它的 {confirmDelete.sessionCount} 个会话，无法恢复。</p>
      <div>
        <button type="button" autoFocus onClick={() => setConfirmDelete(null)}>取消</button>
        <button type="button" className="danger" data-contacts-confirm-delete disabled={busy} onClick={() => { void deleteCharacter() }}>确认删除</button>
      </div>
    </div>}
    {form && <form className="contacts-form" data-contacts-form onSubmit={(event) => { event.preventDefault(); void saveForm() }}>
      <h3>{form.id ? '编辑角色' : '新建角色'}</h3>
      <label>名字<input data-contacts-name value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required maxLength={24} /></label>
      <label>头像（emoji 或单字）<input data-contacts-avatar value={form.avatar} onChange={(event) => setForm({ ...form, avatar: event.target.value })} maxLength={8} placeholder="留空用名字首字" /></label>
      <label>供应商档案
        <select data-contacts-profile value={form.providerProfileId} disabled={form.id === DEFAULT_CHARACTER_ID}
          onChange={(event) => setForm({ ...form, providerProfileId: event.target.value })}>
          {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.builtIn ? '（设置页默认）' : ''}</option>)}
        </select>
      </label>
      {form.id === DEFAULT_CHARACTER_ID && <p className="contacts-hint">内置角色的人设与模型会写回设置页的全局配置。</p>}
      <label>模型<input data-contacts-model value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} required list="contacts-model-options" />
        <datalist id="contacts-model-options">{models.map((model) => <option key={model} value={model} />)}</datalist>
      </label>
      <button type="button" data-contacts-fetch-models onClick={() => { void loadModels() }} disabled={busy}>获取模型列表</button>
      {modelStatus && <p className="contacts-hint" role="status">{modelStatus}</p>}
      <label>人设（系统提示词）<textarea data-contacts-soulmd rows={8} value={form.soulMd}
        onChange={(event) => setForm({ ...form, soulMd: event.target.value })} placeholder="留空使用默认丑鱼人格" /></label>
      <div className="contacts-form-actions">
        <button type="button" onClick={() => setForm(null)}>取消</button>
        <button type="submit" data-contacts-save disabled={busy}>保存</button>
      </div>
    </form>}
  </div>
}
