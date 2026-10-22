import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { AgentFocusRequest } from '../../../../shared/agents'
import { DEFAULT_CHARACTER_ID } from '../../../../shared/characters'
import { parseWorkspacePage, WORKSPACE_PAGE_STATE_KEY, type WorkspacePage } from '../../core/workspace-state'
import { CONTACT_NAVIGATION, type ContactNavigationRequest } from '../Contacts/contactNavigation'
import { captureReturnLocation, saveReturnLocation, peekReturnLocation, takeReturnLocation, validateReturnLocation } from '../Contacts/contactReturnLocation'
import type { AgentDiscussion } from '../Contacts/agentDiscussion'
import type { useSessionWorkspace } from '../ChatPanel/useSessionWorkspace'
import { NavigationAuthority, validateWorkspaceSession, type WorkspaceSessionOrigin } from './workspaceNavigation'
type Session = ReturnType<typeof useSessionWorkspace>
export type WorkspaceNavigationRequest = WorkspacePage | { page: WorkspacePage }
interface Options {
  initialShowSettings?: boolean
  onSettingsClose?: () => void
  sessions: Session['sessions']
  activeSessionId: string
  activeCharacterId: string
  selectStoredSession: Session['selectSession']
  createStoredSession: Session['createSession']
  setAgentDiscussion: Dispatch<SetStateAction<(AgentDiscussion & { sessionId: string }) | null>>
  setShowMessageSearch: Dispatch<SetStateAction<boolean>>
}
export function useWorkspaceNavigation({ initialShowSettings, onSettingsClose, sessions, activeSessionId, activeCharacterId, selectStoredSession, createStoredSession, setAgentDiscussion, setShowMessageSearch }: Options) {
  const [linkedTask, setLinkedTask] = useState<{ characterId: string; name: string; focus?: AgentFocusRequest; initialTab?: 'settings' | 'skills' | 'portfolio'; deliveryFocus?: { ref: import('../../../../shared/contact-content').DeliveryRef; anchor?: import('../../../../shared/contact-content').TextAnchor }; nonce?: number } | null>(null)
  const [messageFocus, setMessageFocus] = useState<{ sessionId: string; messageId: string } | null>(null)
  const [navigationError, setNavigationError] = useState('')
  const [activePage, setActivePage] = useState<WorkspacePage>(initialShowSettings ? 'settings' : 'chat')
  const [visitedPages, setVisitedPages] = useState<Partial<Record<WorkspacePage, boolean>>>({ settings: initialShowSettings })
  const [returnToken, setReturnToken] = useState<string>()
  const returnRecords = useRef(new Map<string, { task: typeof linkedTask; page: WorkspacePage; focus: HTMLElement | null; scroll: HTMLElement | null; session?: WorkspaceSessionOrigin }>())
  const [parkedTasks, setParkedTasks] = useState<{ token: string; task: NonNullable<typeof linkedTask> }[]>([])
  const navigation = useRef(new NavigationAuthority())
  const [pageLoaded, setPageLoaded] = useState(false)
  const pageChanged = useRef(false)
  const settingsCloseRef = useRef(onSettingsClose)
  settingsCloseRef.current = onSettingsClose
  const commitPage = useCallback((page: WorkspacePage) => {
    setVisitedPages(previous => ({ ...previous, [page]: true }))
    setActivePage(page)
    pageChanged.current = true
    void window.electronAPI.db.setState(WORKSPACE_PAGE_STATE_KEY, page).catch(() => { /* Storage failures are reported globally. */ })
    if (page !== 'settings') settingsCloseRef.current?.()
  }, [])
  useEffect(() => {
    let active = true
    void window.electronAPI.db.getState(WORKSPACE_PAGE_STATE_KEY).then(value => {
      // Explicit navigation wins over a late startup read.
      if (!active || pageChanged.current) return
      const page = parseWorkspacePage(value)
      setActivePage(page)
      setVisitedPages(previous => ({ ...previous, [page]: true }))
    }).catch(() => {}).finally(() => { if (active) setPageLoaded(true) })
    return () => { active = false }
  }, [])
  const navigate = useCallback(async (request: WorkspaceNavigationRequest) => {
    navigation.current.begin()
    commitPage(typeof request === 'string' ? request : request.page)
  }, [commitPage])
  const selectSession = useCallback(async (id: string) => {
    await navigation.current.resolve(current => selectStoredSession(id, current), () => {})
  }, [selectStoredSession])
  const createSession = useCallback(async (id?: string) => {
    await navigation.current.resolve(current => createStoredSession(id, current), () => {})
  }, [createStoredSession])
  const openCharacterChat = useCallback(async (characterId: string) => {
    const latest = [...sessions]
      .filter((session) => (session.characterId || DEFAULT_CHARACTER_ID) === characterId)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (latest) await selectSession(latest.id)
    else await createSession(characterId)
    navigate('chat')
  }, [sessions, selectSession, createSession, navigate])

  const focusAssistant = useCallback(async () => {
    const current = navigation.current.begin()
    const workspace = await window.electronAPI.db.getSessionWorkspace()
    current()
    const unread = workspace.sessions.filter(s => (s.unreadCount ?? 0) > 0).sort((a, b) => a.updatedAt - b.updatedAt)[0]
    const assistant = workspace.sessions.filter(s => (s.characterId || DEFAULT_CHARACTER_ID) === DEFAULT_CHARACTER_ID).sort((a, b) => b.updatedAt - a.updatedAt)[0]
    const session = unread ?? assistant
    if (session) await selectStoredSession(session.id, current)
    else await createStoredSession(DEFAULT_CHARACTER_ID, current)
    current(); commitPage('chat')
  }, [selectStoredSession, createStoredSession, commitPage])

  const restoreContactOrigin = async () => {
    if (!returnToken) return
    const token = returnToken, location = peekReturnLocation(token), record = returnRecords.current.get(token)
    if (!location || !record) { setNavigationError('返回位置已失效，请重新打开原事项。'); return }
    const current = navigation.current.begin()
    try {
      await validateReturnLocation(location)
      if (record.session) {
        const workspace = await window.electronAPI.db.getSessionWorkspace()
        current()
        validateWorkspaceSession(record.session, workspace.sessions)
        await selectStoredSession(record.session.id, current)
      }
      current()
      takeReturnLocation(token); returnRecords.current.delete(token)
      setParkedTasks(items => items.filter(item => item.token !== token)); setLinkedTask(record.task); commitPage(record.page)
      setReturnToken([...returnRecords.current.keys()].at(-1)); setNavigationError('')
      requestAnimationFrame(() => requestAnimationFrame(() => {
        try { current() } catch { return }
        window.dispatchEvent(new CustomEvent('chouyu:contact-return', { detail: location }))
        const messages = document.querySelector<HTMLElement>('.workspace-chat .message-area')
        if (record.session && messages) messages.scrollTop = record.session.scrollTop
        if (record.scroll?.isConnected) record.scroll.scrollTop = location.scrollTop
        if (record.focus?.isConnected) record.focus.focus({ preventScroll: true })
      }))
    } catch (e) { try { current(); setNavigationError(e instanceof Error ? e.message : '无法返回原事项。') } catch { /* A newer navigation owns the error surface. */ } }
  }
  useEffect(() => {
    const handle = (event: Event) => {
      const request = (event as CustomEvent<ContactNavigationRequest>).detail
      request.handled = true
      setNavigationError('')
      const current = navigation.current.begin()
      const origin = ['settings', 'contact-settings'].includes(request.target.kind) ? captureReturnLocation() : undefined
      const saveOrigin = () => {
        if (!origin) return
        const token = saveReturnLocation(origin.location)
        returnRecords.current.set(token, { task: linkedTask, page: activePage, focus: origin.focus, scroll: origin.scroll,
          session: activePage === 'chat' ? { id: activeSessionId, characterId: activeCharacterId, scrollTop: document.querySelector('.workspace-chat .message-area')?.scrollTop ?? 0 } : undefined })
        for (const old of returnRecords.current.keys()) if (!peekReturnLocation(old)) returnRecords.current.delete(old)
        setParkedTasks(items => [...items.filter(item => peekReturnLocation(item.token)), ...(linkedTask ? [{ token, task: linkedTask }] : [])]); setReturnToken(token)
      }
      void (async () => {
        const target = request.target
        if (target.kind === 'settings') {
          saveOrigin(); window.dispatchEvent(new CustomEvent('chouyu:contact-navigation-opened', { detail: { preserve: !!origin } })); if (origin) setLinkedTask(null); commitPage('settings')
        } else if (target.kind === 'contact-settings') {
          const contacts = await window.electronAPI.characters.list()
          current()
          const contact = contacts.find(c => c.id === target.characterId)
          if (!contact) throw new Error('联系人已删除，无法打开设置。')
          saveOrigin(); window.dispatchEvent(new CustomEvent('chouyu:contact-navigation-opened', { detail: { preserve: !!origin } }))
          setLinkedTask({ characterId: contact.id, name: contact.name, initialTab: target.tab, nonce: Date.now() })
        } else if (target.kind === 'discuss') {
          const ref = target.citation.ref
          const citation = await window.electronAPI.agents.validateCitation(ref.characterId, target.citation)
          const artifact = await window.electronAPI.agents.delivery(ref.characterId, ref.topicId, ref.version)
          current()
          if (!artifact) throw new Error('引用的成果已移除。')
          const section = artifact.sections.find(s => s.id === ref.sectionId)
          window.dispatchEvent(new Event('chouyu:contact-navigation-opened'))
          const latest = sessions.filter(s => (s.characterId || DEFAULT_CHARACTER_ID) === ref.characterId).sort((a, b) => b.updatedAt - a.updatedAt)[0]
          if (latest) await selectStoredSession(latest.id, current)
          else await createStoredSession(ref.characterId, current)
          current(); commitPage('chat')
          const workspace = await window.electronAPI.db.getSessionWorkspace()
          if (workspace.activeSession.characterId !== ref.characterId) throw new Error('会话已切换，请重新引用。')
          current()
          setAgentDiscussion({ sessionId: workspace.activeSession.id, citation, title: `${section?.title ?? '成果'} · 版本 ${ref.version}`, topicId: ref.topicId, runId: artifact.runId, text: citation.anchor?.quote ?? section?.body.slice(0, 2000) ?? artifact.summary })
          setLinkedTask(null)
        } else if (target.kind === 'delivery') {
          const contacts = await window.electronAPI.characters.list()
          const contact = contacts.find(c => c.id === target.ref.characterId)
          if (!contact) throw new Error('联系人已删除，无法打开成果。')
          const artifact = await window.electronAPI.agents.delivery(contact.id, target.ref.topicId, target.ref.version)
          current()
          if (!artifact || (target.ref.sectionId && !artifact.sections.some(s => s.id === target.ref.sectionId))) throw new Error('找不到引用的成果分节。')
          window.dispatchEvent(new Event('chouyu:contact-navigation-opened'))
          setLinkedTask({ characterId: contact.id, name: contact.name, initialTab: 'portfolio', deliveryFocus: target, nonce: Date.now() })
        } else if (target.kind === 'interaction') {
          const contacts = await window.electronAPI.characters.list()
          const contact = contacts.find(c => c.id === target.characterId)
          if (!contact) throw new Error('联系人已删除，无法打开这条待处理事项。')
          const interaction = await window.electronAPI.agents.getInteraction(target.characterId, target.interactionId)
          if (interaction.kind === 'action') {
            if (interaction.characterId !== target.characterId) throw new Error('交互事项归属已变化。')
            await selectStoredSession(interaction.request.sessionId, current)
            const workspace = await window.electronAPI.db.getSessionWorkspace()
            current()
            if (!workspace.activeSession.messages.some(m => m.id === interaction.id)) throw new Error('原卡片消息已删除，可在联系人的待处理事项中查看。')
            window.dispatchEvent(new Event('chouyu:contact-navigation-opened'))
            setMessageFocus({ sessionId: interaction.request.sessionId, messageId: interaction.id }); setShowMessageSearch(false); setLinkedTask(null); commitPage('chat')
            request.resolve(); return
          }
          const work = await window.electronAPI.agents.get(target.characterId)
          current()
          if (interaction.characterId !== target.characterId || interaction.topicId !== target.topicId || !work.topics.some(topic => topic.id === target.topicId)) throw new Error('这条待处理事项的来源已失效，请重新读取联系人近况。')
          window.dispatchEvent(new Event('chouyu:contact-navigation-opened'))
          setLinkedTask({ characterId: contact.id, name: contact.name, focus: { topicId: interaction.topicId, runId: interaction.runId, interactionId: interaction.id, kind: 'question', tab: 'work', nonce: Date.now() } })
        } else if (target.kind === 'task') {
          const contacts = await window.electronAPI.characters.list()
          const contact = contacts.find(c => c.id === target.characterId)
          if (!contact) throw new Error('这项任务或联系人已删除，原始总结仍保留。')
          const work = await window.electronAPI.agents.get(target.characterId)
          current()
          if (!work.topics.some(t => t.id === target.topicId)) throw new Error('这项任务或联系人已删除，原始总结仍保留。')
          const run = work.runs.find(r => r.topicId === target.topicId)
          window.dispatchEvent(new Event('chouyu:contact-navigation-opened'))
          setLinkedTask({ characterId: contact.id, name: contact.name, focus: { topicId: target.topicId, runId: run?.id ?? '', kind: run?.status === 'waiting' ? 'question' : 'progress', tab: 'work', nonce: Date.now() } })
        } else {
          await selectStoredSession(target.sessionId, current)
          const workspace = await window.electronAPI.db.getSessionWorkspace()
          if (!workspace.activeSession.messages.some(m => m.id === target.messageId)) throw new Error('对应聊天消息已删除，执行结果仍可在任务历史中查看。')
          window.dispatchEvent(new Event('chouyu:contact-navigation-opened'))
          current()
          setMessageFocus(target); setShowMessageSearch(false); setLinkedTask(null); commitPage('chat')
        }
        request.resolve()
      })().catch(error => { try { current(); setNavigationError(error.message) } catch { /* superseded */ } request.reject(error) })
    }
    window.addEventListener(CONTACT_NAVIGATION, handle)
    return () => window.removeEventListener(CONTACT_NAVIGATION, handle)
  }, [selectStoredSession, createStoredSession, commitPage, sessions, activeSessionId, activeCharacterId, linkedTask, activePage, setAgentDiscussion, setShowMessageSearch])
  return { activePage, visitedPages, pageLoaded, navigate, linkedTask, setLinkedTask, parkedTasks,
    returnToken, restoreContactOrigin, returnToOrigin: restoreContactOrigin, navigationError, setNavigationError,
    messageFocus, setMessageFocus, openCharacterChat, focusAssistant, selectSession, createSession }
}
