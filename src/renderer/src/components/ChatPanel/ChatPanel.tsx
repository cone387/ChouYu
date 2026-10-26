import type { ComponentProps, Dispatch, SetStateAction } from 'react'
import type { AgentFocusRequest } from '../../../../shared/agents'
import type { ToolApprovalRequest } from '../../../../shared/tools'
import type { MemoryConflictAction, MemoryRecord } from '../../../../shared/memory'
import { ASSISTANT_CHARACTER_ID, DEFAULT_CHARACTER_ID, INDUSTRY_LABELS } from '../../../../shared/characters'
import type { AppConfig, PluginInfo } from '../../shared/types'
import { MAX_HISTORY_MESSAGES } from '../../shared/constants'
import type { AgentDiscussion } from '../Contacts/agentDiscussion'
import CharacterAvatar from '../CharacterAvatar/CharacterAvatar'
import OnboardingCard from '../Onboarding/OnboardingCard'
import MemoryCandidateCard from '../Memory/MemoryCandidateCard'
import MessageArea from './MessageArea'
import InputArea from './InputArea'
import ContactWorkToolbar from './ContactWorkToolbar'
import type { useSessionWorkspace } from './useSessionWorkspace'

type Session = ReturnType<typeof useSessionWorkspace>
type Setter<T> = Dispatch<SetStateAction<T>>
type Focus = AgentFocusRequest & { sessionId: string }
type Discussion = AgentDiscussion & { sessionId: string }
export type ChatPanelModel = Pick<Session,
  'workspaceError' | 'retryWorkspace' | 'workspaceLoaded' | 'activeSessionId' | 'messages' | 'isStreaming' |
  'retryAssistantMessage' | 'continueAssistantMessage' | 'activeCharacterId' | 'replyViewportRef' |
  'clearCurrentSession' | 'handleStopGeneration'> & {
  activeCharacter: Session['characters'][number] | null
  config: AppConfig
  showOnboarding: boolean
  customCharacterActive: boolean
  openContactsDetail(id: string): void
  openAISettings(): void
  messageFocus: { sessionId: string; messageId: string } | null
  setMessageFocus: Setter<ChatPanelModel['messageFocus']>
  setAgentFocus: Setter<Focus | null>
  agentFocus: Focus | null
  visible: boolean
  isChat: boolean
  toolApprovalRequest: ToolApprovalRequest | null
  confirmClear: boolean
  setConfirmClear: Setter<boolean>
  showMessageSearch: boolean
  messageSearchQuery: string
  setShowMessageSearch: Setter<boolean>
  requestComposerFocus(): void
  handleEditMessage(messageId: string, content: string): void
  submitMemoryFeedback: NonNullable<ComponentProps<typeof MessageArea>['onMemoryFeedback']>
  correctMemory(id: string): void
  activeAssistantUnread: number
  markVisibleMessagesRead(): void
  memoryCandidates: MemoryRecord[]
  memoryCandidateBusy: boolean
  resolveMemoryCandidate(action: MemoryConflictAction | 'approve'): Promise<void>
  memoryCandidateError: string
  memoryWriteNotice: string
  setAgentDiscussion: Setter<Discussion | null>
  agentDiscussion: Discussion | null
  handleSend: ComponentProps<typeof InputArea>['onSend']
  composerFocusRequest: number
  handleModelChange(model: string): Promise<string>
  onScreenshot: ComponentProps<typeof InputArea>['onScreenshot']
  onScrollScreenshot: ComponentProps<typeof InputArea>['onScrollScreenshot']
  plugins: PluginInfo[]
  pluginCommands: { cmd: string; desc: string }[]
  activePluginForInput: PluginInfo | null
  setActivePluginForInput: Setter<PluginInfo | null>
  pendingAttachment: ComponentProps<typeof InputArea>['initialAttachment']
  onPendingAttachmentConsumed?: () => void
  inputHistory: string[]
}

/** Retained chat surface. Workspace owns navigation and the single session lifetime. */
export default function ChatPanel({ model }: { model: ChatPanelModel }) {
  const { activeCharacter, showOnboarding, customCharacterActive, openContactsDetail, config, openAISettings, workspaceError, retryWorkspace, workspaceLoaded, messageFocus, activeSessionId, setMessageFocus, setAgentFocus, visible, isChat, toolApprovalRequest, confirmClear, showMessageSearch, messageSearchQuery, setShowMessageSearch, requestComposerFocus, messages, isStreaming, retryAssistantMessage, handleEditMessage, continueAssistantMessage, submitMemoryFeedback, correctMemory, activeCharacterId, replyViewportRef, activeAssistantUnread, markVisibleMessagesRead, setConfirmClear, clearCurrentSession, memoryCandidates, memoryCandidateBusy, resolveMemoryCandidate, memoryCandidateError, memoryWriteNotice, agentFocus, setAgentDiscussion, agentDiscussion, handleSend, handleStopGeneration, composerFocusRequest, handleModelChange, onScreenshot, onScrollScreenshot, plugins, pluginCommands, activePluginForInput, setActivePluginForInput, pendingAttachment, onPendingAttachmentConsumed, inputHistory } = model
  return (<div className="chat-panel-main">
            {/* 引导卡 overflow:hidden 且可被 flex 压缩，信息条占位会把它挤出可用高度裁掉按钮，故首次运行引导期间不渲染。 */}
            {activeCharacter && !(showOnboarding && !customCharacterActive) && (
              <div className="character-context-bar" role="status">
                <button type="button" className="character-context-main" data-character-bar={activeCharacter.id}
                  onClick={() => openContactsDetail(activeCharacter.id)} title="查看联系人详情">
                  <span className="character-context-avatar" aria-hidden="true"><CharacterAvatar character={activeCharacter} /></span>
                  <span className="character-context-name">{activeCharacter.name}</span>
                  {activeCharacter.builtIn && <em className="character-context-badge">内置</em>}
                  <span className="character-context-model">{activeCharacter.builtIn || !activeCharacter.model ? config.model : activeCharacter.model}</span>
                  {activeCharacter.category && <span className="character-context-category">{INDUSTRY_LABELS[activeCharacter.category] ?? activeCharacter.category}</span>}
                </button>
              </div>
            )}
            {showOnboarding && !customCharacterActive && <OnboardingCard onConfigure={openAISettings} />}
            {workspaceError && <div className="memory-candidate-error" role="alert">{workspaceError}<button onClick={retryWorkspace}>重新加载</button></div>}
            {workspaceLoaded && (
              <MessageArea
                focusMessageId={messageFocus?.sessionId === activeSessionId ? messageFocus.messageId : undefined}
                onClearMessageFocus={() => setMessageFocus(null)}
                onAgentNotice={(ref, tab) => setAgentFocus({ ...ref, tab, nonce: Date.now(), sessionId: activeSessionId })}
                active={visible && isChat && !toolApprovalRequest && !confirmClear}
                character={activeCharacter}
                key={activeSessionId}
                searchOpen={showMessageSearch}
                initialSearch={messageSearchQuery}
                onCloseSearch={() => { setShowMessageSearch(false); requestComposerFocus() }}
                messages={messages}
                isStreaming={isStreaming}
                onRetry={retryAssistantMessage}
                onEditMessage={handleEditMessage}
                onContinueMessage={continueAssistantMessage}
                contextLimit={MAX_HISTORY_MESSAGES}
                onMemoryFeedback={submitMemoryFeedback}
                onCorrectMemory={correctMemory}
                canSnooze={activeCharacterId === DEFAULT_CHARACTER_ID}
                sessionId={activeSessionId}
                replyViewportRef={replyViewportRef}
                onRead={activeAssistantUnread ? markVisibleMessagesRead : undefined}
              />
            )}
            {confirmClear && (
              <div className="clear-session-confirm" role="alertdialog" aria-labelledby="clear-session-title">
                <div>
                  <strong id="clear-session-title">清空当前对话？</strong>
                  <span>消息将从这个会话中永久删除。</span>
                </div>
                <div className="clear-session-actions">
                  <button type="button" autoFocus onClick={() => { setConfirmClear(false); requestComposerFocus() }}>取消</button>
                  <button type="button" className="danger" onClick={() => { setConfirmClear(false); void clearCurrentSession() }}>确认清空</button>
                </div>
              </div>
            )}
            {memoryCandidates[0] && (
              <MemoryCandidateCard
                candidate={memoryCandidates[0]}
                remaining={memoryCandidates.length}
                busy={memoryCandidateBusy}
                reviewReason={memoryCandidates[0].confidence < config.memoryAutoWriteConfidence
                  ? '表达中包含不确定信息，确认后才会写入长期记忆。'
                  : config.memoryWriteMode === 'confirm'
                    ? '当前设置要求每条候选记忆都由你确认。'
                    : undefined}
                onResolve={(action) => { void resolveMemoryCandidate(action) }}
              />
            )}
            {memoryCandidateError && <div className="memory-candidate-error" role="alert">{memoryCandidateError}</div>}
            {memoryWriteNotice && <div className="memory-write-notice" role="status">{memoryWriteNotice}</div>}
            {workspaceLoaded && activeCharacter && activeCharacterId !== ASSISTANT_CHARACTER_ID &&
              <ContactWorkToolbar key={`${activeSessionId}:${activeCharacter.id}`} characterId={activeCharacter.id} suspended={!visible || !isChat} focusRequest={agentFocus?.sessionId === activeSessionId ? agentFocus : undefined}
                onDiscuss={reference => setAgentDiscussion({ ...reference, sessionId: activeSessionId })}
                name={activeCharacter.name} onClose={() => { setAgentFocus(null); requestComposerFocus() }} />}
            <InputArea
              characterId={activeCharacterId}
              contactTasks={Boolean(activeCharacter && activeCharacterId !== ASSISTANT_CHARACTER_ID)}
              discussion={agentDiscussion?.sessionId === activeSessionId ? agentDiscussion : undefined}
              onDiscussionConsumed={() => setAgentDiscussion(null)}
              sessionId={activeSessionId}
              active={visible && isChat && !toolApprovalRequest}
              onSend={handleSend}
              onStop={handleStopGeneration}
              disabled={!workspaceLoaded}
              isStreaming={isStreaming}
              focusRequest={composerFocusRequest}
              model={activeCharacter && !activeCharacter.builtIn && activeCharacter.model ? activeCharacter.model : config.model}
              onModelChange={handleModelChange}
              fetchModels={activeCharacter && !activeCharacter.builtIn
                ? () => window.electronAPI.characters.fetchModels(activeCharacter.providerProfileId)
                : undefined}
              onScreenshot={onScreenshot}
              onScrollScreenshot={onScrollScreenshot}
              plugins={plugins}
              pluginCommands={pluginCommands}
              initialActivePlugin={activePluginForInput}
              onInitialPluginConsumed={() => setActivePluginForInput(null)}
              initialAttachment={pendingAttachment}
              onInitialAttachmentConsumed={onPendingAttachmentConsumed}
              history={inputHistory}
            />
          </div>)
}
