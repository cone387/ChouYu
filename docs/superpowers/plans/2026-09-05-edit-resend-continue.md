# 消息编辑重发 + 停止后继续生成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 任意用户消息可气泡内编辑并截断重发；已停止的助手消息可继续流式追加到原消息尾部。

**Architecture:** 纯函数（`core/conversation-actions.ts`）承担可单测的对话变换与守卫；`useSessionWorkspace.generateAIResponse` 增加"追加模式"参数（seed 内容 + 目标消息 id）；ChatPanel 负责记忆重分析（复用从 handleSend 抽出的 `proposeMemories`）；MessageArea 增加行内编辑态与两个 meta 按钮。持久化复用现有整数组覆盖 + 防抖自动保存，零新 IPC。

**Tech Stack:** React 18 + TypeScript + vitest（纯函数真单测 + 源字符串守卫，项目无 jsdom）。

**Spec:** `docs/superpowers/specs/2026-09-05-edit-resend-continue-design.md`

**对 spec 的一处修正：** 记忆提取由**用户消息**触发（`ChatPanel.handleSend` 里的 `window.electronAPI.memory.propose(content, sessionId, userMessage.id)`），不是生成完成触发。因此：编辑重发对新文本重新跑 `proposeMemories`（忠实"重发"语义）；继续生成没有新用户消息，无需记忆提取。

**关键现状锚点（写码前先读）：**
- `src/renderer/src/core/conversation-actions.ts` — 现有 `getConversationForRetry`（12 行）
- `src/renderer/src/components/ChatPanel/useSessionWorkspace.ts:222-361` — `generateAIResponse`；`363-387` 停止（占位文案 `'已停止生成。'` 在 381 行）；`389-396` `retryAssistantMessage`；`398-422` 返回对象
- `src/renderer/src/components/ChatPanel/ChatPanel.tsx:494-508` — handleSend 里的记忆 propose 块（将被抽成 `proposeMemories`）；`739-746` — `<MessageArea>` 接线
- `src/renderer/src/components/ChatPanel/MessageArea.tsx:97-135` — props 与 state；`150-251` — 消息渲染与 meta 区
- 守卫测试文件 `stream-render.test.ts` 已读取 `workspaceSource`/`inputSource`/`panelSource`/`messageAreaSource`/`chatPanelCssSource` 四个源

---

### Task 1: 纯函数 `getEditedConversation` / `getContinuationSeed` / `STOPPED_PLACEHOLDER_CONTENT`

**Files:**
- Modify: `src/renderer/src/core/conversation-actions.ts`
- Create: `src/renderer/src/core/conversation-actions.test.ts`

- [ ] **Step 1: 写失败的单测**

创建 `src/renderer/src/core/conversation-actions.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import type { Message } from '../shared/types'
import {
  getContinuationSeed,
  getConversationForRetry,
  getEditedConversation,
  STOPPED_PLACEHOLDER_CONTENT
} from './conversation-actions'

function userMessage(overrides: Partial<Message> = {}): Message {
  return { id: 'u1', role: 'user', content: '原始消息', timestamp: 1, ...overrides }
}

function assistantMessage(overrides: Partial<Message> = {}): Message {
  return { id: 'a1', role: 'assistant', content: '回复内容', timestamp: 2, ...overrides }
}

describe('getEditedConversation', () => {
  const messages = [
    userMessage({ id: 'u1', content: '第一条' }),
    assistantMessage({ id: 'a1' }),
    userMessage({ id: 'u2', content: '第二条' }),
    assistantMessage({ id: 'a2' })
  ]

  it('truncates after the edited message and replaces its content, keeping id and timestamp', () => {
    const edited = getEditedConversation(messages, 'u1', '改后的第一条')
    expect(edited).toEqual([userMessage({ id: 'u1', content: '改后的第一条', timestamp: 1 })])
  })

  it('edits the last user message without dropping it', () => {
    const only = [userMessage({ id: 'u1', content: '唯一' })]
    expect(getEditedConversation(only, 'u1', '改后')).toEqual([userMessage({ id: 'u1', content: '改后' })])
  })

  it('keeps the image attachment of the edited message', () => {
    const withImage = [userMessage({ id: 'u1', content: '带图', imageUrl: 'data:image/png;base64,x' })]
    expect(getEditedConversation(withImage, 'u1', '新文本')?.[0].imageUrl).toBe('data:image/png;base64,x')
  })

  it('returns null for unknown ids, assistant targets and blank content', () => {
    expect(getEditedConversation(messages, 'nope', 'x')).toBeNull()
    expect(getEditedConversation(messages, 'a1', 'x')).toBeNull()
    expect(getEditedConversation(messages, 'u1', '   ')).toBeNull()
    expect(getEditedConversation(messages, 'u1', '')).toBeNull()
  })
})

describe('getContinuationSeed', () => {
  it('returns the partial content of a stopped assistant message', () => {
    expect(getContinuationSeed([assistantMessage({ responseStatus: 'stopped' })], 'a1')).toBe('回复内容')
  })

  it('seeds empty for the stopped placeholder message', () => {
    const placeholder = assistantMessage({ content: STOPPED_PLACEHOLDER_CONTENT, responseStatus: 'stopped' })
    expect(getContinuationSeed([placeholder], 'a1')).toBe('')
  })

  it('returns null unless the target is a stopped plain assistant message', () => {
    expect(getContinuationSeed([assistantMessage()], 'a1')).toBeNull()
    expect(getContinuationSeed([assistantMessage({ responseStatus: 'error' })], 'a1')).toBeNull()
    expect(getContinuationSeed([userMessage()], 'u1')).toBeNull()
    expect(getContinuationSeed([], 'a1')).toBeNull()
    const withTool = assistantMessage({ responseStatus: 'stopped', toolData: { steps: [] } as Message['toolData'] })
    expect(getContinuationSeed([withTool], 'a1')).toBeNull()
  })
})

describe('getConversationForRetry stays intact', () => {
  it('still truncates to the last user message for the final assistant reply', () => {
    const messages = [
      userMessage({ id: 'u1' }),
      assistantMessage({ id: 'a1' })
    ]
    expect(getConversationForRetry(messages, 'a1')).toEqual([userMessage({ id: 'u1' })])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/renderer/src/core/conversation-actions.test.ts`
Expected: FAIL —— `getEditedConversation` / `getContinuationSeed` / `STOPPED_PLACEHOLDER_CONTENT` 不存在（导入报错）。

- [ ] **Step 3: 最小实现**

`src/renderer/src/core/conversation-actions.ts` 全文替换为：

```ts
import type { Message } from '../shared/types'

/** handleStopGeneration 在流被截断且未产生任何文本时写入的占位内容。 */
export const STOPPED_PLACEHOLDER_CONTENT = '已停止生成。'

export function getConversationForRetry(messages: Message[], assistantMessageId: string): Message[] | null {
  const assistantIndex = messages.findIndex((message) => message.id === assistantMessageId)
  if (assistantIndex <= 0 || assistantIndex !== messages.length - 1) return null
  const assistant = messages[assistantIndex]
  if (assistant.role !== 'assistant' || assistant.pluginData || assistant.toolData) return null
  let userIndex = assistantIndex - 1
  while (userIndex >= 0 && messages[userIndex].role !== 'user') userIndex -= 1
  if (userIndex < 0) return null
  return messages.slice(0, userIndex + 1)
}

/** 编辑某条用户消息：截断其后所有消息并替换文本；保留 id、imageUrl、timestamp。 */
export function getEditedConversation(messages: Message[], userMessageId: string, newContent: string): Message[] | null {
  const userIndex = messages.findIndex((message) => message.id === userMessageId)
  if (userIndex < 0) return null
  const userMessage = messages[userIndex]
  if (userMessage.role !== 'user' || userMessage.toolData || userMessage.pluginData) return null
  if (!newContent.trim()) return null
  return messages.slice(0, userIndex + 1).map((message, index) =>
    index === userIndex ? { ...message, content: newContent } : message
  )
}

/** 已停止的纯文本助手消息可继续生成；返回续写的 seed 内容（占位消息 seed 为空串）。 */
export function getContinuationSeed(messages: Message[], assistantMessageId: string): string | null {
  const target = messages.find((message) => message.id === assistantMessageId)
  if (!target || target.role !== 'assistant' || target.pluginData || target.toolData) return null
  if (target.responseStatus !== 'stopped') return null
  return target.content === STOPPED_PLACEHOLDER_CONTENT ? '' : target.content
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/renderer/src/core/conversation-actions.test.ts`
Expected: PASS 全绿。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/core/conversation-actions.ts src/renderer/src/core/conversation-actions.test.ts
git commit -m "feat(core): pure conversation transforms for edit-resend and continue"
```

---

### Task 2: `generateAIResponse` 追加模式 + `editUserMessage` / `continueAssistantMessage`

**Files:**
- Modify: `src/renderer/src/components/ChatPanel/useSessionWorkspace.ts`
- Modify: `src/renderer/src/components/ChatPanel/stream-render.test.ts`（新增守卫 describe）

- [ ] **Step 1: 写失败的守卫测试**

在 `stream-render.test.ts` 末尾新增：

```ts
describe('message edit and continue generation', () => {
  it('seeds append-mode generations with the stopped message content', () => {
    expect(workspaceSource).toContain('options.appendTo?.seedContent ?? \'\'')
    expect(workspaceSource).toContain('options.appendTo?.messageId ??')
    expect(workspaceSource).toContain('appendTo?: GenerationAppend')
    expect(workspaceSource).toContain('从中断处自然地继续写完剩余内容')
  })

  it('exposes edit and continue handlers guarded like retry', () => {
    expect(workspaceSource).toContain('const editUserMessage = useCallback')
    expect(workspaceSource).toContain('const continueAssistantMessage = useCallback')
    expect(workspaceSource).toContain('getEditedConversation(messages, messageId, newContent)')
    expect(workspaceSource).toContain('getContinuationSeed(messages, messageId)')
    expect(workspaceSource).toContain('editUserMessage,\n    continueAssistantMessage')
  })

  it('reuses the stopped placeholder constant', () => {
    expect(workspaceSource).toContain('STOPPED_PLACEHOLDER_CONTENT')
    expect(workspaceSource).not.toContain(\"'已停止生成。'\")
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/renderer/src/components/ChatPanel/stream-render.test.ts`
Expected: 新 describe 的 3 个用例 FAIL。

- [ ] **Step 3: 实现 useSessionWorkspace 改动**

3a. 第 15 行 import 改为：

```ts
import { getContinuationSeed, getConversationForRetry, getEditedConversation, STOPPED_PLACEHOLDER_CONTENT } from '../../core/conversation-actions'
```

3b. 在 `STREAM_RENDER_INTERVAL_MS` 常量（32 行）之前加类型：

```ts
interface GenerationAppend {
  messageId: string
  seedContent: string
}

interface GenerationOptions {
  /** 追加模式：流式内容拼接到既有消息（停止后继续生成）。 */
  appendTo?: GenerationAppend
}
```

3c. `generateAIResponse` 签名（222 行）改为，并在开头初始化 seed：

```ts
  const generateAIResponse = useCallback(async (conversation: Message[], sessionId = activeSessionIdRef.current, options: GenerationOptions = {}) => {
    if (!sessionId) return
    if (sessionGenerationsRef.current.has(sessionId)) {
      pendingGenerationsRef.current.add(sessionId)
      return
    }
    const responseBaseId = options.appendTo?.messageId ?? `${Date.now()}-assistant`
    let segmentIndex = 0
    let aiMsgId = responseBaseId
    let accumulated = options.appendTo?.seedContent ?? ''
```

（只改 `responseBaseId`、`accumulated` 两行与签名，其余不动。）

3d. 261-262 行系统提示注入续写指令：

```ts
    const continuationPolicy = options.appendTo
      ? '上一条回复被中断了。请从中断处自然地继续写完剩余内容，不要重复已写部分，不要重新开头。'
      : ''
    const systemPrompt = buildSystemPrompt(config.soulMd, [memoryContext, memoryConversationPolicy, continuationPolicy].filter(Boolean).join('\n\n'))
```

3e. `handleStopGeneration` 中 381 行占位文案改为常量：

```ts
        content: STOPPED_PLACEHOLDER_CONTENT,
```

3f. 在 `retryAssistantMessage`（389-396 行）之后加两个 handler：

```ts
  const editUserMessage = useCallback((messageId: string, newContent: string) => {
    if (isStreaming) return
    const conversation = getEditedConversation(messages, messageId, newContent)
    if (!conversation) return
    const sessionId = activeSessionIdRef.current
    updateSessionMessages(sessionId, () => conversation)
    void generateAIResponse(conversation, sessionId)
  }, [messages, isStreaming, generateAIResponse, updateSessionMessages])

  const continueAssistantMessage = useCallback((messageId: string) => {
    if (isStreaming) return
    const seedContent = getContinuationSeed(messages, messageId)
    if (seedContent === null) return
    void generateAIResponse(messages, activeSessionIdRef.current, { appendTo: { messageId, seedContent } })
  }, [messages, isStreaming, generateAIResponse])
```

3g. 返回对象（`retryAssistantMessage` 之后）追加：

```ts
    retryAssistantMessage,
    editUserMessage,
    continueAssistantMessage
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/renderer/src/components/ChatPanel/stream-render.test.ts`
Expected: PASS（含新 describe）。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ChatPanel/useSessionWorkspace.ts src/renderer/src/components/ChatPanel/stream-render.test.ts
git commit -m "feat(renderer): append-mode generation plus edit and continue handlers"
```

---

### Task 3: ChatPanel 接线（`proposeMemories` 抽取 + `handleEditMessage` + props）

**Files:**
- Modify: `src/renderer/src/components/ChatPanel/ChatPanel.tsx`
- Modify: `src/renderer/src/components/ChatPanel/stream-render.test.ts`

- [ ] **Step 1: 写失败的守卫测试**

在 `stream-render.test.ts` 的 `describe('message edit and continue generation')` 里追加一个用例：

```ts
  it('re-proposes memory for edited text and wires both actions into MessageArea', () => {
    expect(panelSource).toContain('const proposeMemories = useCallback')
    expect(panelSource).toContain('proposeMemories(newContent, sessionId, messageId)')
    expect(panelSource).toContain('const handleEditMessage = useCallback')
    expect(panelSource).toContain('onEditMessage={handleEditMessage}')
    expect(panelSource).toContain('onContinueMessage={continueAssistantMessage}')
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/renderer/src/components/ChatPanel/stream-render.test.ts`
Expected: 该用例 FAIL。

- [ ] **Step 3: 实现 ChatPanel 改动**

3a. `useSessionWorkspace({...})` 解构（约 114 行区域）追加 `editUserMessage, continueAssistantMessage`（紧跟 `retryAssistantMessage` 若有；按现有解构风格排一行或换行均可）。

3b. 把 `handleSend` 中 494-508 行的记忆 propose 块抽成 `proposeMemories`（放在 handleSend 之前）：

```ts
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
```

`handleSend` 中原 494-508 行整块替换为一行：

```ts
    proposeMemories(content, sessionId, userMessage.id)
```

（注意：原块外层条件 `if (config.memoryEnabled && content.trim())` 已移入 `proposeMemories`，此处直接调用。）

3c. 在 `handleSend` 之后加：

```ts
  const handleEditMessage = useCallback((messageId: string, newContent: string) => {
    const sessionId = activeSessionIdRef.current
    proposeMemories(newContent, sessionId, messageId)
    editUserMessage(messageId, newContent)
  }, [proposeMemories, editUserMessage])
```

依赖数组按 lint 提示补齐（`activeSessionIdRef` 是 ref 无需列入）。

3d. `<MessageArea>`（739-746 行）追加两个 props：

```tsx
              <MessageArea
                messages={messages}
                isStreaming={isStreaming}
                onRetry={retryAssistantMessage}
                onEditMessage={handleEditMessage}
                onContinueMessage={continueAssistantMessage}
                contextLimit={MAX_HISTORY_MESSAGES}
                onMemoryFeedback={submitMemoryFeedback}
                onCorrectMemory={correctMemory}
              />
```

- [ ] **Step 4: 跑测试 + 类型检查**

Run: `npx vitest run src/renderer/src/components/ChatPanel/stream-render.test.ts && npm run typecheck:web`
Expected: PASS / 无错误。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ChatPanel/ChatPanel.tsx src/renderer/src/components/ChatPanel/stream-render.test.ts
git commit -m "feat(renderer): wire edit-resend with memory re-proposal into chat panel"
```

---

### Task 4: MessageArea 编辑 UI + 继续按钮 + CSS

**Files:**
- Modify: `src/renderer/src/components/ChatPanel/MessageArea.tsx`
- Modify: `src/renderer/src/components/ChatPanel/ChatPanel.css`
- Modify: `src/renderer/src/components/ChatPanel/stream-render.test.ts`

- [ ] **Step 1: 写失败的守卫测试**

在 `stream-render.test.ts` 的 `describe('message edit and continue generation')` 里再追加两个用例：

```ts
  it('edits user messages inline with a truncation warning', () => {
    expect(messageAreaSource).toContain('onEditMessage?: (messageId: string, newContent: string) => void')
    expect(messageAreaSource).toContain('const [editingId, setEditingId]')
    expect(messageAreaSource).toContain('保存并重发')
    expect(messageAreaSource).toContain('保存将删除之后的')
    expect(messageAreaSource).toContain("e.key === 'Escape'")
    expect(messageAreaSource).toContain("e.key === 'Enter' && !e.shiftKey")
  })

  it('continues stopped assistant messages in place', () => {
    expect(messageAreaSource).toContain('onContinueMessage?: (messageId: string) => void')
    expect(messageAreaSource).toContain('继续生成')
    expect(messageAreaSource).toContain("msg.responseStatus === 'stopped' && !msg.toolData")
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/renderer/src/components/ChatPanel/stream-render.test.ts`
Expected: 两个新用例 FAIL。

- [ ] **Step 3: 实现 MessageArea**

3a. props 接口（11-18 行）追加两行并解构：

```ts
interface MessageAreaProps {
  messages: Message[]
  isStreaming: boolean
  onRetry?: (messageId: string) => void
  onEditMessage?: (messageId: string, newContent: string) => void
  onContinueMessage?: (messageId: string) => void
  contextLimit?: number
  onMemoryFeedback?: (messageId: string, memoryId: string, sourceIds: string[] | undefined, value: MemoryFeedbackValue) => Promise<void>
  onCorrectMemory?: (memoryId: string) => void
}
```

组件签名解构加入 `onEditMessage, onContinueMessage`。

3b. state 区（100-102 行后）加：

```ts
  const [editingId, setEditingId] = useState('')
  const [editDraft, setEditDraft] = useState('')
  const commitEdit = (messageId: string) => {
    const draft = editDraft
    setEditingId('')
    if (!draft.trim()) return
    onEditMessage?.(messageId, draft)
  }
```

3c. 用户消息内容分支（原 200-201 行 `msg.content && <span>{msg.content}</span>`）改为编辑态分支：

```tsx
              ) : msg.id === editingId ? (
                <div className="message-edit">
                  <textarea
                    className="message-edit-textarea"
                    value={editDraft}
                    autoFocus
                    aria-label="编辑消息内容"
                    onChange={(e) => setEditDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault()
                        setEditingId('')
                      } else if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        commitEdit(msg.id)
                      }
                    }}
                  />
                  {index < messages.length - 1 && (
                    <div className="message-edit-warning" role="status">
                      保存将删除之后的 {messages.length - 1 - index} 条消息
                    </div>
                  )}
                  <div className="message-edit-actions">
                    <button type="button" onClick={() => setEditingId('')}>取消</button>
                    <button type="button" className="primary" onClick={() => commitEdit(msg.id)} disabled={!editDraft.trim()}>保存并重发</button>
                  </div>
                </div>
              ) : (
                msg.content && <span>{msg.content}</span>
              )}
```

（编辑态在条件链中位于 assistant Markdown 分支之后，只有 user/system 消息会走到；`index` 来自渲染循环的 `const index = start + offset`。）

3d. meta 区（204-222 行）在 canRetry 按钮之前插入编辑按钮、之后插入继续按钮：

```tsx
              {msg.role === 'user' && !isStreaming && !msg.toolData && onEditMessage && msg.id !== editingId && (
                <button
                  className="message-edit-btn"
                  onClick={() => { setEditingId(msg.id); setEditDraft(msg.content) }}
                  aria-label="编辑这条消息"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M11.3 2.7l2 2L6 12l-3 1 1-3z"/>
                  </svg>
                  编辑
                </button>
              )}
```

```tsx
              {!isStreaming && msg.role === 'assistant' && msg.responseStatus === 'stopped' && !msg.toolData && !msg.pluginData && onContinueMessage && (
                <button
                  className="message-continue-btn"
                  onClick={() => onContinueMessage(msg.id)}
                  aria-label="继续生成这条回复"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 2.5v11l9-5.5z"/>
                  </svg>
                  继续生成
                </button>
              )}
```

- [ ] **Step 4: 实现 CSS**

4a. `.message-retry-btn` 两条规则（约 855-872 行）选择器扩展共享样式：

```css
.message-retry-btn,
.message-edit-btn,
.message-continue-btn {
  /* 原 .message-retry-btn 规则体保持不变 */
```

```css
.message-retry-btn:hover,
.message-edit-btn:hover,
.message-continue-btn:hover {
  /* 原 hover 体保持不变 */
```

4b. 在 `.message-retry-btn` 区块之后新增：

```css
.message-edit {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  max-width: 100%;
  width: 100%;
}

.message-edit-textarea {
  width: 100%;
  min-height: 64px;
  max-height: 220px;
  resize: vertical;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-4);
  font-size: 14px;
  line-height: 1.5;
  font-family: inherit;
  background: var(--bg-panel);
  color: var(--text-primary);
  outline: none;
  box-sizing: border-box;
}

.message-edit-textarea:focus-visible {
  border-color: var(--accent);
}

.message-edit-warning {
  color: var(--warning);
  font-size: 10px;
}

.message-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.message-edit-actions button {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-3);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 10px;
}

.message-edit-actions button.primary {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}

.message-edit-actions button.primary:disabled {
  opacity: 0.5;
  cursor: default;
}
```

- [ ] **Step 5: 跑全量测试确认通过**

Run: `npx vitest run`
Expected: 全部 PASS（DesignTokens 回归会强制 CSS 无裸 px 间距——上面间距全部 token 化，字号 px 与既有用法一致）。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/ChatPanel/MessageArea.tsx src/renderer/src/components/ChatPanel/ChatPanel.css src/renderer/src/components/ChatPanel/stream-render.test.ts
git commit -m "feat(renderer): inline message editing and continue button in chat meta"
```

---

### Task 5: 全量门禁 + 手动验收 + roadmap 收尾

**Files:**
- Modify: `docs/roadmap.md`

- [ ] **Step 1: 全量门禁**

Run: `npm run typecheck:node && npm run typecheck:web && npx vitest run && npm run build`
Expected: 全部通过。

- [ ] **Step 2: 手动验收（npm run dev，用户参与）**

清单：
1. 发一条消息得回复后，编辑**最后一条**用户消息 → 仅替换内容并重新生成
2. 多轮对话后编辑**中间**用户消息 → 出现「保存将删除之后的 N 条消息」警示 → 保存后后续消息消失、重新生成
3. 编辑时 Esc 取消、Shift+Enter 换行、清空文本后保存按钮禁用
4. 流式生成中：编辑/继续/重新生成按钮均不出现
5. 停止一条回复 → 「继续生成」追加到原消息尾部、`已停止` 标记消失；再次停止→再次继续，循环正常
6. 停止后点「重新生成」仍走旧路径（截断重写）
7. 带截图的用户消息编辑 → 图片保留
8. 亮/暗主题下编辑框和警示条可读；窄面板（375px 等效）无横向滚动

- [ ] **Step 3: roadmap 打勾**

`docs/roadmap.md` P1 计划中：
`- [ ] 消息编辑后重发、停止后继续生成` → `- [x] 消息编辑后重发、停止后继续生成`
测试计数如有变化同步更新。

Run:
```bash
git add docs/roadmap.md
git commit -m "docs: tick edit-resend and continue-generation roadmap item"
```

---

## Self-Review 记录

- **Spec 覆盖**：编辑范围/截断/警示（Task 1、4）、行内编辑交互（Task 4）、追加式继续（Task 2、4）、记忆处理（Task 3，按 spec 修正节说明）、守卫测试（Task 1-4）、门禁验收（Task 5）——全覆盖。
- **占位符**：无 TBD/“稍后实现”；每个改码步骤都有完整代码。
- **类型一致性**：`GenerationAppend`/`GenerationOptions`（Task 2 定义，generateAIResponse 签名使用）；`getEditedConversation(messages, userMessageId, newContent)` / `getContinuationSeed(messages, assistantMessageId)`（Task 1 定义，Task 2/3 调用签名一致）；`onEditMessage(messageId, newContent)` / `onContinueMessage(messageId)`（Task 3 传入、Task 4 定义同形）。
