# 消息编辑重发 + 停止后继续生成（2026-09-05）

## 背景与决策

P1 UI/UX 剩余项。三个关键语义已确认：

1. **编辑范围**：任意用户消息可编辑，保存后截断其后的所有消息并重发（不搞分支树）；之后有消息时就地警示，不做弹窗。
2. **编辑交互**：气泡内行内编辑（textarea 预填原文），不回填底部输入框。
3. **继续生成**：新内容流式追加到已停止的同一条消息尾部，不开新气泡。

现状可复用的先例：`getConversationForRetry`（截断最后一条助手消息再生成）、持久化为整数组覆盖（`saveSessionMessages`，无 per-message IPC）、停止时 partial 内容立即落库（`responseStatus: 'stopped'`）。

## 变更点

**交互（MessageArea.tsx）**
- 用户消息 hover 时 meta 区出现「编辑」按钮（与复制按钮同排）；点击后该气泡进入编辑态：textarea 预填原文（自动增高）、「取消 / 保存并重发」按钮；Enter 保存、Esc 取消、Shift+Enter 换行。
- 编辑中的消息之后还有消息时，编辑区内嵌警示「保存将删除之后的 N 条消息」。
- 附件图片原样保留（`imageUrl` 不动），只编辑文本。
- `已停止` 的助手消息（无 toolData/pluginData）meta 区在现有「重新生成」旁增加「继续生成」按钮；错误消息仍只有「重试」。
- 流式生成中编辑/继续/重试按钮一律不出现（与现状一致）。

**数据流（useSessionWorkspace.ts + core/conversation-actions.ts）**
- `getEditedConversation(messages, messageId, newContent)`（纯函数，紧挨 `getConversationForRetry`）：返回 `slice(0, userIndex + 1)` 并替换该条 content（保留 id、imageUrl、timestamp）；目标不存在或 newContent 去空白后为空时返回 null（编辑按钮不出现/动作 no-op）。
- `editUserMessage(messageId, newContent)`：流式中 no-op → 调用纯函数 → `updateSessionMessages` → `generateAIResponse(conversation)`；持久化走现有防抖自动保存。
- `continueAssistantMessage(messageId)`：guard（!isStreaming、`responseStatus === 'stopped'`、无 toolData/pluginData）→ 以追加模式调用生成器。
- `generateAIResponse` 增加追加模式参数：目标消息 id + seed 内容（= 该消息已有 content），流式 chunk 拼接到 seed 之后，`renderAccumulated` upsert 同一消息 id，开始时清除 `responseStatus`，完成时照常走 memory 提取与持久化。
- 发给模型的上下文 = 当前完整对话（含半截回复）+ 系统级续写指令「从中断处继续，不要重复已有内容」。
- InputArea 不动（无新注入 prop）。

**样式（ChatPanel.css）**
- 编辑态 textarea、编辑按钮、继续按钮、截断警示条，全部 token 化；复用 message-meta 按钮模式（`.message-retry-btn` 同款）。

## 边界与非目标（YAGNI）

- 停止→继续→再停止：幂等循环，无特殊状态。
- 被截断消息的 memoryRefs 不回收（与「重新生成」现状一致）。
- 编辑态是消息条目局部 state；窗口化滚动导致编辑中的条目卸载即丢弃编辑内容（编辑通常发生在最近消息，可接受）。
- 不做：分支树/分支切换、编辑助手消息、编辑附件图片、继续按钮用于正常完成的消息、新 IPC。

## 测试与验收

- `conversation-actions` 纯函数单测：编辑 slice/替换内容/保留 imageUrl 与 id；继续 guard 的通过与拒绝条件。
- 源守卫测试（ChatPanel.layout / stream-render 风格）：编辑/继续按钮接线、追加模式 seed 拼接、截断警示文案、流式中禁用。
- 门禁：typecheck:node/web + vitest 全量 + build；`npm run dev` 手验：编辑中间消息截断、编辑最后一条、继续半截回复、继续后再停止。
