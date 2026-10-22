import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { DEFAULT_CHARACTER_ID } from '../../../../shared/characters'
import { isAIConfigured } from '../../../../shared/config'
import type { MemoryRecord } from '../../../../shared/memory'
import type { Message, PluginMessageData, PluginInfo, AppConfig } from '../../shared/types'
import type { WorkspacePage } from '../../core/workspace-state'
import type { PendingAttachment } from './InputArea'
import type { useSessionWorkspace } from './useSessionWorkspace'
type Session = ReturnType<typeof useSessionWorkspace>
type Setter<T> = Dispatch<SetStateAction<T>>
type Options = Pick<Session, 'activeSessionIdRef' | 'happyTimerRef' | 'updateSessionMessages' | 'generateAIResponse' |
  'createSession' | 'activeCharacterId' | 'sessionMessagesRef' | 'messages' | 'isStreaming' | 'editUserMessage'> & {
  config: AppConfig
  setConfig: Setter<AppConfig>
  setShowOnboarding: Setter<boolean>
  setConfirmClear: Setter<boolean>
  setMemoryCandidates: Setter<MemoryRecord[]>
  showMemoryWriteNotice(message: string): void
  plugins: PluginInfo[]
  navigate(page: WorkspacePage): Promise<void>
  openMemoryWorkspace(): void
  customCharacterActive: boolean
  activeCharacter: Session['characters'][number] | null
}
/** Chat commands retain their originating session across asynchronous plugin/model work. */
export function useChatCommands({ config, setConfig, setShowOnboarding, setConfirmClear, setMemoryCandidates, showMemoryWriteNotice, activeSessionIdRef, happyTimerRef, plugins, updateSessionMessages, generateAIResponse, createSession, activeCharacterId, navigate, openMemoryWorkspace, customCharacterActive, sessionMessagesRef, messages, isStreaming, editUserMessage, activeCharacter }: Options) {
  const proposeMemories = useCallback((content: string, sessionId: string, messageId: string) => {
    if (!config.memoryEnabled || !content.trim()) return
    showMemoryWriteNotice('正在分析这条消息是否需要记住…')
    void window.electronAPI.memory.propose(content, sessionId, messageId).then((candidates) => {
      const pendingCandidates = candidates.filter((candidate) => candidate.status === 'pending')
      if (pendingCandidates.length > 0) {
        setMemoryCandidates((previous) => [...previous, ...pendingCandidates.filter((candidate) => !previous.some((item) => item.id === candidate.id))])
        showMemoryWriteNotice(`发现 ${pendingCandidates.length} 条记忆候选，等待确认`)
        return
      }
      const activeCandidates = candidates.filter((candidate) => candidate.status === 'active')
      if (activeCandidates.some((candidate) => candidate.type === 'person')) showMemoryWriteNotice('身份档案已更新')
      else if (activeCandidates.length > 0) showMemoryWriteNotice(`已自动保存 ${activeCandidates.length} 条记忆`)
      else showMemoryWriteNotice('这条消息未识别为需要保存的用户信息')
    }).catch((error) => showMemoryWriteNotice(error instanceof Error ? `Mem0 记忆写入失败：${error.message}` : 'Mem0 记忆写入失败，请检查连接配置'))
  }, [config.memoryEnabled, showMemoryWriteNotice])

  const handleSend = async (content: string, attachments?: PendingAttachment[], contactCitations?: import('../../../../shared/contact-content').ContentCitation[]) => {
    const originatingSessionId = activeSessionIdRef.current
    if (happyTimerRef.current) {
      clearTimeout(happyTimerRef.current)
      happyTimerRef.current = null
    }

    for (const plugin of plugins) {
      const prefix = `/${plugin.command} `
      if (content.startsWith(prefix) || content === `/${plugin.command}`) {
        const extractedContent = content.startsWith(prefix) ? content.slice(prefix.length) : ''
        const result: PluginMessageData = await window.electronAPI.plugin.execute(plugin.id, extractedContent)
        const resultMessage: Message = {
          id: Date.now().toString(),
          role: 'assistant',
          content: result.message,
          timestamp: Date.now(),
          pluginData: result
        }
        updateSessionMessages(originatingSessionId, (previous) => [...previous, resultMessage])

        const feedToPetSetting = await window.electronAPI.db.getState(`plugin:${plugin.id}:feedToPet`)
        if (feedToPetSetting === 'true' && result.ok) {
          const petPrompt = `用户刚通过 ${plugin.name} 插件执行了操作：\n输入：${extractedContent}\n结果：${result.message}\n\n请用你的性格简短评论一下（1-2句话）。`
          const petMsgId = (Date.now() + 2).toString()
          await generateAIResponse(
            [{ role: 'user', content: petPrompt, id: petMsgId + '-prompt', timestamp: Date.now() }],
            originatingSessionId
          )
        }
        return
      }
    }

    if (content === '/clear') {
      setConfirmClear(true)
      return
    }
    if (content === '/new') {
      await createSession()
      return
    }
    if (content === '/help') {
      updateSessionMessages(originatingSessionId, (previous) => [...previous, {
        id: Date.now().toString(),
        role: 'assistant',
        content: '可用指令：\n- `/new` 新建对话\n- `/clear` 清空当前对话\n- `/remember 内容` 创建记忆候选\n- `/memory` 打开记忆工作区\n- `/journal` 打开工作日志\n- `/settings` 打开设置\n- `/model` 切换模型\n- `/help` 查看帮助',
        timestamp: Date.now()
      }])
      return
    }
    if (content === '/remember' || content.startsWith('/remember ')) {
      const memoryText = content.slice('/remember'.length).trim()
      if (!memoryText) {
        updateSessionMessages(originatingSessionId, (previous) => [...previous, { id: Date.now().toString(), role: 'assistant', content: '用法：`/remember 需要记住的内容`。', timestamp: Date.now() }])
        return
      }
      if (!config.memoryEnabled) {
        updateSessionMessages(originatingSessionId, (previous) => [...previous, { id: Date.now().toString(), role: 'assistant', content: '长期记忆已在设置中关闭。', timestamp: Date.now() }])
        return
      }
      if (activeCharacterId !== DEFAULT_CHARACTER_ID) {
        try {
          await window.electronAPI.agents.remember(activeCharacterId, memoryText)
          showMemoryWriteNotice('已存入此联系人的独立记忆，可在联系人详情中查看。')
        } catch (error) { showMemoryWriteNotice(error instanceof Error ? error.message : '独立记忆保存失败，请重试。') }
        return
      }
      const candidates = await window.electronAPI.memory.propose(`请记住：${memoryText}`, originatingSessionId)
      const pendingCandidates = candidates.filter((candidate) => candidate.status === 'pending')
      setMemoryCandidates((previous) => [...previous, ...pendingCandidates.filter((candidate) => !previous.some((item) => item.id === candidate.id))])
      return
    }
    if (content === '/journal') {
      navigate('journal')
      return
    }
    if (content === '/memory') {
      openMemoryWorkspace()
      return
    }
    if (content === '/settings') {
      navigate('settings')
      return
    }
    if (content === '/model' || content.startsWith('/model ')) {
      const requestedModel = content.slice('/model'.length).trim()
      if (!requestedModel) {
        updateSessionMessages(originatingSessionId, (previous) => [...previous, {
          id: Date.now().toString(),
          role: 'assistant',
          content: '请从输入框右下角的模型菜单中选择模型，或输入 `/model 模型名称`。',
          timestamp: Date.now()
        }])
        return
      }
      try {
        const savedModel = await handleModelChange(requestedModel)
        updateSessionMessages(originatingSessionId, (previous) => [...previous, {
          id: Date.now().toString(),
          role: 'assistant',
          content: `已切换到模型 \`${savedModel}\`。`,
          timestamp: Date.now()
        }])
      } catch (error) {
        const message = error instanceof Error ? error.message : '模型切换失败'
        updateSessionMessages(originatingSessionId, (previous) => [...previous, {
          id: Date.now().toString(),
          role: 'assistant',
          content: `模型切换失败：${message}`,
          timestamp: Date.now()
        }])
      }
      return
    }

    if (!customCharacterActive && !isAIConfigured(config)) {
      setShowOnboarding(true)
      updateSessionMessages(originatingSessionId, (previous) => [...previous, { id: Date.now().toString(), role: 'assistant', content: '尚未完成 AI Provider 配置。请填写 Base URL、API Key 和模型并通过连接检测后再开始对话。', timestamp: Date.now() }])
      return
    }

    let messageContent = content
    const imageAttachment = attachments?.find((attachment) => attachment.type === 'image')
    const textAttachments = attachments?.filter((attachment) => attachment.type === 'text') || []
    if (textAttachments.length > 0) {
      const textParts = textAttachments.map((attachment) => `[附件: ${attachment.name}]\n${attachment.data.slice(0, 2000)}`)
      messageContent = content ? `${content}\n\n${textParts.join('\n\n')}` : textParts.join('\n\n')
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: messageContent,
      ...(contactCitations?.length ? { contactCitations } : {}),
      timestamp: Date.now(),
      imageUrl: imageAttachment?.data
    }
    const sessionId = activeSessionIdRef.current
    const currentMessages = sessionMessagesRef.current.get(sessionId) || messages
    const nextMessages = [...currentMessages, userMessage]
    updateSessionMessages(sessionId, () => nextMessages)
    proposeMemories(content, sessionId, userMessage.id)
    await generateAIResponse(nextMessages, sessionId)
  }

  const handleEditMessage = useCallback((messageId: string, newContent: string) => {
    if (isStreaming) return
    const sessionId = activeSessionIdRef.current
    proposeMemories(newContent, sessionId, messageId)
    editUserMessage(messageId, newContent)
  }, [isStreaming, proposeMemories, editUserMessage])

  // 模型切换的唯一入口：自定义角色的模型属于角色本身（characters.update 全量草稿，
  // 其余字段必须原样带回——漏掉 category 会抹掉行业分类），内置角色仍写回设置页的全局配置。
  // 返回实际落库的模型供反馈文案使用。
  const handleModelChange = useCallback(async (newModel: string): Promise<string> => {
    if (activeCharacter && !activeCharacter.builtIn) {
      const updated = await window.electronAPI.characters.update(activeCharacter.id, {
        name: activeCharacter.name,
        avatar: activeCharacter.avatar,
        soulMd: activeCharacter.soulMd,
        providerProfileId: activeCharacter.providerProfileId,
        category: activeCharacter.category,
        model: newModel
      })
      return updated.model
    }
    const saved = await window.electronAPI.db.saveConfig({ model: newModel })
    setConfig(saved)
    return saved.model
  }, [activeCharacter])

  return { handleSend, handleEditMessage, handleModelChange }
}
