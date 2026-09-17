# 助手内置联系人与会话化主动消息设计

日期:2026-09-17
状态:已与用户确认
前置:2026-09-17-tray-unread-flash-design.md(托盘闪动/红点/入口,本设计重构其未读来源与打开目标)

## 背景与目标

主动提醒引擎工作正常但独立的消息中心(ProactiveCenter)不可发现。用户决定:助手成为内置联系人(微信"文件传输助手"式),主动消息直接进混合最近会话列表;移除独立消息中心与宠物气泡。

用户确认的决策:
1. 助手可回复,接全局 AI 配置
2. 删除 8 秒宠物气泡
3. 旧 proactive-messages 历史迁入助手会话
4. "稍后提醒"保留,改造为消息上的操作
5. 路线 A:真联系人 + 真会话(消息入库,复用会话能力)

## 1. 助手角色

- `src/shared/characters.ts`:
  - 新常量 `ASSISTANT_CHARACTER_ID = 'assistant'`,助手名"助手",avatar 🔔
  - `Character.builtIn` 已有;`normalizeCharacters` 在默认角色旁播种助手(保留级:不受 `MAX_CHARACTER_COUNT` 限制、用户不可建同名、不可删除/编辑、重复数据中被剔除只留一份)
  - 助手携带固定 `soulMd`(简洁、主动关怀风格,常量定义于 characters.ts)
- `resolveCharacterConfig`:内置角色且 `character.soulMd` 非空 → 优先用角色自身 soulMd(助手);默认丑鱼 soulMd 恒空,行为不变(仍用全局 soulMd)。供应商/模型解析路径与默认角色一致(全局 AI 配置)
- `src/renderer/src/components/Contacts/ContactsView.tsx`:助手置顶显示(不可编辑/删除,点击 `onOpenChat(ASSISTANT_CHARACTER_ID)`)

## 2. 消息管道

- 数据库 `src/main/database.ts` 新导出 `appendAssistantMessage(content: string, timestamp?: number): SessionWorkspace`:
  1. 确保 `assistant` 角色存在(normalizeCharacters 已保证)
  2. 查找 `characterId === 'assistant'` 的最近会话,无则创建(标题"助手消息")
  3. 追加 `Message { role: 'assistant', content, timestamp: timestamp ?? Date.now() }`
  4. 更新会话 `updatedAt`,持久化,返回新 workspace
- IPC:`src/main/ipc.ts` 注册 `ipcMain.handle('proactive:append', ...)`;写库后若 `mainWindow` 存在则 `webContents.send('sessions:changed')`(仿 `characters:changed` 先例,含 removeAllListeners 防重)
- preload/类型:`proactiveAppend: (content: string) => Promise<void>`、`onSessionsChanged: (cb) => unsubscribe`
- `ChatPanel` 监听 `sessions:changed` → 重拉 `getSessionWorkspace` 并 `applyWorkspace(workspace, true)`(保留侧栏顺序;若变化的是当前会话,合并消息时以库为准)

## 3. 未读模型(通用机制)

- `ChatSession` 增可选字段 `lastReadAt?: number`(normalize 容忍缺失,无需版本升级)
- 未读数 = `messages.filter(m => m.timestamp > (lastReadAt ?? 0)).length`
- 标读时机(`db:mark-session-read` IPC 落库,`selectSession` 的处理器内自动置 `lastReadAt`):
  - 选中某会话时
  - 新消息到达的会话为当前活跃会话且聊天面板处于展开状态(App 持有 `panelVisible`,经 prop 传入 ChatPanel;不用 `document.visibilityState`——宠物窗口恒可见,该信号无效)→ 自动标读(阅读中不再累计未读)
- `ConversationSidebar` 会话项显示未读数徽标(>0 时;封顶显示 99+;红色 #ff4d4f 与宠物红点同色系)
- **未读计算在主进程**:`database.ts` 导出 `getAssistantUnreadCount()`;托盘 `setTrayUnread` 改由主进程在 `appendAssistantMessage`、`db:save-session-messages`(标读落库)、`db:delete-session` 后直接调用
- 主进程广播 `assistant-unread-changed`(count)→ App 监听驱动宠物红点(方向与上一批相反:渲染层推送通道 `proactive-unread-changed` 退役)

## 4. 托盘与入口

- 新通道 `open-assistant-chat`(main→renderer):
  - 托盘单击(助手未读>0)→ 发送(无未读仍开聊天面板,现状)
  - 托盘右键"助手消息"→ 发送
- App:监听 `onOpenAssistantChat` → 打开聊天面板(复用 openChatPanel 流程)+ `assistantFocusRequest` 计数器 state
- ChatPanel:新 prop `assistantFocusRequest: number`,变化时执行 `openCharacterChat(ASSISTANT_CHARACTER_ID)`(选中/创建助手会话并 navigate('chat'),顺带标读)
- 宠物右键"助手消息"→ 同一 App 处理器
- 移除:`open-messages-center` 通道、preload `onOpenMessages`/`setProactiveUnread`

## 5. 稍后提醒(保留)

- `ProactiveEngine` 重构为纯调度器:移除消息存储/持久化/水合/markAllRead/remove/getMessages;`speak(message, kind)` 只做冷却记账并触发回调
- 新 API `snoozeContent(content: string, minutes = 10)`:存 `{id, content, dueAt}` 到 db state `assistant-snoozes`,设定时器;到点经同一管道追加助手消息「⏰ 稍前提醒：{content}」
- 启动时读取 `assistant-snoozes`:未来项重挂定时器,过期项立即逐条追加(错过的提醒不当丢)
- UI:`MessageArea` 中,当前会话 `characterId === 'assistant'` 且消息 `role === 'assistant'` 的消息条 hover 显示"稍后提醒"操作(仅此一处入口,固定 10 分钟)
- 任务提醒(`onTasksReminder`/`onTasksStoreRebuilt`)改走 `proactiveAppend`(文本不变:"任务提醒：{title}"、"错过了 N 条任务提醒"、"任务数据文件无法读取…")

## 6. 历史迁移

- db 加载完成后(初始化路径):若 state 无 `proactive-migrated` 标记且 `proactive-messages` 非空 → 校验条目(id/message/createdAt),按 createdAt 升序逐条 `appendAssistantMessage(message, createdAt)` → 写标记
- 旧 key 保留不再读写;一次性、幂等

## 7. 移除清单

- `src/renderer/src/components/ProactiveCenter/`(组件 + CSS)
- App.tsx:`proactiveMsg`/`proactiveMessages`/`showProactiveCenter` 状态、ProactiveCenter 渲染、气泡渲染与 8 秒自动消失 effect、`onOpenMessages` effect、未读推送 effect、水合 effect、`persistProactiveMessages`
- preload/types:`setProactiveUnread`、`onOpenMessages`
- 主进程:`ipcMain.on('proactive-unread-changed')` 监听(tray.ts);`open-messages-center` 发送改 `open-assistant-chat`
- 引擎内消息存储与 `postExternal`(语义并入 speak/回调)
- 顺带失去(本批不做,已向用户声明):任务提醒消息上的"跳转到任务"按钮

## 8. 错误处理

- 追加/标读写库失败 → 现有存储故障提示机制(writesBlocked/StorageNotice),不中断引擎计时
- 助手对话时 AI 未配置 → 现有 `resolveCharacterConfig` 报错文案路径,不特殊处理
- `sessions:changed` 到达而 workspace 拉取失败 → 保留现有 workspace,下次事件重试(无新增状态)

## 9. 测试

1. `database.test.ts`:appendAssistantMessage(首次建会话/后续追加/updatedAt 提升/自定义 timestamp);getAssistantUnreadCount(标读前后);迁移(旧数据导入一次、标记幂等、坏条目跳过)
2. `characters` 相关测试:助手恒被播种、去重、不占上限;resolveCharacterConfig 优先助手 soulMd、默认角色不变
3. `proactive.test.ts` 重写:speak 只回调不存储;冷却不变;snoozeContent 到点触发回调并持久化
4. 布局契约测试更新:ChatPanel(assistantFocusRequest prop)、Pet(onOpenMessages 语义变更)、pet-icon.test.ts(tray 源断言更新为 open-assistant-chat)
5. `chat-smoke.ts`:主动消息断言改为"问候后助手会话出现在会话列表"
6. 手动验收(用户执行,通过后才合 master):
   - 删 `Local Storage` 重启 → 3 秒问候作为助手消息出现在会话列表顶部,托盘闪、红点亮、旧 9 条历史在助手会话里
   - 点托盘/托盘右键/宠物右键 → 打开助手会话,未读清零、停闪、红点灭
   - 助手会话输入消息 → AI 正常回复(全局配置)
   - 消息 hover"稍后提醒" → 10 分钟后收到"⏰ 稍前提醒"新消息(可临时改短定时验证)
   - 无未读时托盘单击 → 仍开聊天(不回归)

## 10. 不做的事

- 任务提醒消息的跳转动作;系统通知;macOS Dock badge;未读免打扰/按会话静音;稍后提醒时长选择(固定 10 分钟);助手会话多开(恒用最近一个助手会话)

## 验收标准

- 一切主动消息只存在于助手会话;会话列表实时出现、含未读徽标
- 助手可对话(AI 全局配置);历史 9 条可查
- 托盘闪/停闪、红点、三个入口(托盘单击/托盘菜单/宠物右键)全部指向助手会话
- 现有 test 与 smoke 基线不回归(相关断言随本设计更新)
