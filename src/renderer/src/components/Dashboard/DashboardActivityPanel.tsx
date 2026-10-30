import { useEffect, useState } from 'react'
import type { AppConfig } from '../../../../shared/config'
import type { CharacterStats } from '../../../../shared/characters'
import type { SessionWorkspace } from '../../shared/types'
import ContactsActivityLog from '../Contacts/ContactsActivityLog'
import ContactsView from '../Contacts/ContactsView'
import { useContactsDashboard } from '../Contacts/useContactsDashboard'
import { navigateContact } from '../Contacts/contactNavigation'

export default function DashboardActivityPanel({ active, config, onOpenChat, onDeleted, reload }: {
  active: boolean; config: AppConfig; onOpenChat(id: string): void; onDeleted(workspace: SessionWorkspace): void; reload: number
}) {
  const [characters, setCharacters] = useState<CharacterStats[]>()
  const [detailId, setDetailId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [listError, setListError] = useState('')
  const [navigationError, setNavigationError] = useState('')
  const [retry, setRetry] = useState(0)
  const { data, error } = useContactsDashboard(active, reload + retry)
  useEffect(() => {
    if (!active) return
    let alive = true, sequence = 0
    const refresh = async () => {
      const request = ++sequence
      try {
        const next = await window.electronAPI.characters.list()
        if (!alive || request !== sequence) return
        setCharacters(next); setListError('')
        setDetailId(id => id && next.some(character => character.id === id) ? id : null)
        setFocusId(id => id && next.some(character => character.id === id) ? id : null)
      } catch { if (alive && request === sequence) setListError('联系人读取失败，当前保留上次活动。') }
    }
    void refresh()
    const dispose = window.electronAPI.characters.onChanged(() => { void refresh() })
    return () => { alive = false; dispose() }
  }, [active, reload, retry])
  const readError = listError || error
  const openTask = (characterId: string, topicId: string) => {
    setNavigationError('')
    void navigateContact({ kind: 'task', characterId, topicId }).catch(reason => setNavigationError(reason instanceof Error ? reason.message : '暂时无法打开这项任务。'))
  }
  return <aside className="dashboard-live-activity" aria-label="全员活动记录">
    <ContactsActivityLog data={characters ? data : undefined} error={readError} characters={characters ?? []} active={active}
      onDetail={character => { setDetailId(character.id); setFocusId(character.id) }} onTask={openTask} />
    {readError && <p className="dashboard-error" role="alert">{readError}<button type="button" onClick={() => setRetry(value => value + 1)}>重试</button></p>}
    {navigationError && <p className="dashboard-error" role="alert">{navigationError}<button type="button" onClick={() => setNavigationError('')}>关闭</button></p>}
    {detailId && <ContactsView active={active} config={config} detailOnly focusCharacterId={focusId}
      onFocusConsumed={() => setFocusId(null)} onDismiss={() => { setDetailId(null); setFocusId(null) }}
      onOpenChat={id => { setDetailId(null); setFocusId(null); onOpenChat(id) }} onDeleted={onDeleted} />}
  </aside>
}
