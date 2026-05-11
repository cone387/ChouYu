# AI Pet 系统架构

## 产品定位

一个住在桌面上的有性格的 AI 助手。平时安静待着，需要时快捷键唤出帮你干活。
用"有性格的角色"包装实用工具，让工具有温度、有记忆、像朋友。

- **开源项目** —— 社区贡献角色/插件/皮肤
- **官网分发** —— 打包桌面程序供下载
- **本地优先** —— 所有数据默认本地，云端是可选增强

---

## 设计原则

1. **分层解耦** —— 每层只依赖下一层的接口，不依赖实现
2. **事件驱动** —— 模块间通过事件总线通信，不直接调用
3. **插件化** —— 感知能力、AI 能力、工具能力都可热插拔
4. **渐进增强** —— V1 最小可用，每版叠加能力，不过度设计

---

## 系统分层架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      PRESENTATION LAYER                          │
│                        （表现层）                                 │
│                                                                 │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌─────────────┐  │
│  │ 2D Render │  │ 3D Render │  │ Chat UI   │  │ Settings UI │  │
│  │ (Lottie)  │  │ (V4:VRM)  │  │ (Bubble)  │  │ (Panel)     │  │
│  └───────────┘  └───────────┘  └───────────┘  └─────────────┘  │
│                                                                 │
│  说明: V1 直接用 Lottie，V4 引入 3D 时再提取 Render Adapter     │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
┌──────────────────────────────────┼──────────────────────────────┐
│                      BEHAVIOR LAYER                              │
│                       （行为层）                                  │
│                                                                 │
│  ┌───────────────────────┐  ┌────────────────────────────────┐  │
│  │  Proactive Engine     │  │   Interaction State Machine    │  │
│  │                       │  │                                │  │
│  │ - 触发规则            │  │ - idle / talking /             │  │
│  │ - 时机判断            │  │   listening / sleeping         │  │
│  │ - 频率控制（低频）    │  │ - 状态转换条件                 │  │
│  │ - V2 加入             │  │                                │  │
│  └───────────────────────┘  └────────────────────────────────┘  │
│                                                                 │
│  说明:                                                           │
│  - 不设独立 Emotion Engine，性格/语气通过 Prompt 人设实现        │
│  - State Machine 管"宠物当前处于什么状态"                        │
│  - Proactive Engine 管"什么时候该主动说话"                       │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │         EVENT BUS           │
                    │       （全局事件总线）        │
                    │                            │
                    │  独立基础设施，不归属任何层   │
                    │  跨 Main/Renderer 进程通信   │
                    │  底层传输: Electron IPC      │
                    └──────────────┬──────────────┘
                                   │
┌──────────────────────────────────┼──────────────────────────────┐
│                       CORE LAYER                                 │
│                       （核心层）                                  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    AI Engine                              │   │
│  │                                                          │   │
│  │  ┌────────────┐  ┌────────────┐  ┌───────────────────┐  │   │
│  │  │ LLM Router │  │ Tool       │  │ Prompt Builder    │  │   │
│  │  │            │  │ Executor   │  │                   │  │   │
│  │  │ - OpenAI   │  │            │  │ - system prompt   │  │   │
│  │  │ - Claude   │  │ - 总结     │  │ - 人格模板        │  │   │
│  │  │ - Ollama   │  │ - 翻译     │  │   (SOUL.md)       │  │   │
│  │  │            │  │ - 读文档   │  │ - 上下文注入      │  │   │
│  │  │            │  │ - 看图     │  │ - 记忆摘要        │  │   │
│  │  │            │  │ - 代码辅助 │  │                   │  │   │
│  │  │            │  │ - 搜索     │  │                   │  │   │
│  │  └────────────┘  └────────────┘  └───────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   Memory System                           │   │
│  │                                                          │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │   │
│  │  │ Short-term  │  │ Long-term    │  │ Identity       │  │   │
│  │  │ (对话上下文) │  │ (向量检索)   │  │ (SOUL.md)      │  │   │
│  │  │             │  │              │  │                │  │   │
│  │  │ - 最近N轮   │  │ - SQLite     │  │ - 名字/性格    │  │   │
│  │  │ - 内存持有   │  │ - Embedding  │  │ - 说话风格     │  │   │
│  │  │ - 退出时存盘 │  │ - 时间衰减   │  │ - 关系定义     │  │   │
│  │  └─────────────┘  └──────────────┘  └────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
┌──────────────────────────────────┼──────────────────────────────┐
│                    PERCEPTION LAYER                              │
│                      （感知层）                                   │
│                                                                 │
│  ┌───────────┐ ┌───────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ Screen    │ │ Clipboard │ │ File     │ │ Active Window    │ │
│  │ Capture   │ │ Watcher   │ │ Drop     │ │ Monitor          │ │
│  │ (V3)      │ │ (V2)      │ │ (V2)     │ │ (V2)             │ │
│  └─────┬─────┘ └─────┬─────┘ └────┬─────┘ └────────┬─────────┘ │
│        │              │            │                 │           │
│  ┌─────▼──────────────▼────────────▼─────────────────▼────────┐ │
│  │              Perception Plugin Interface                    │ │
│  │         （统一感知插件接口 —— 新增感知只需实现此接口）         │ │
│  │                                                            │ │
│  │  注意: 感知插件跑在 Main Process（需要 native API）         │ │
│  │  通过 IPC → Event Bus 发送事件到 Renderer                  │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
┌──────────────────────────────────┼──────────────────────────────┐
│                    PLATFORM LAYER                                │
│                     （平台层）                                    │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                  Electron Main Process                      │ │
│  │                                                            │ │
│  │  ┌──────────┐ ┌──────────┐ ┌────────┐ ┌────────────────┐  │ │
│  │  │ Window   │ │ Tray     │ │ Global │ │ IPC Bridge     │  │ │
│  │  │ Manager  │ │ Manager  │ │ Hotkey │ │ (Main↔Renderer)│  │ │
│  │  │          │ │          │ │        │ │                │  │ │
│  │  │          │ │          │ │        │ │ Event Bus 的    │  │ │
│  │  │          │ │          │ │        │ │ 跨进程传输层    │  │ │
│  │  └──────────┘ └──────────┘ └────────┘ └────────────────┘  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                  Storage Layer                              │ │
│  │                                                            │ │
│  │  ┌──────────────┐  ┌───────────────┐  ┌────────────────┐  │ │
│  │  │ SQLite       │  │ File System   │  │ Config Store   │  │ │
│  │  │ (记忆/向量)   │  │ (SOUL.md等)   │  │ (用户设置)     │  │ │
│  │  └──────────────┘  └───────────────┘  └────────────────┘  │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

---

## 事件总线 —— 跨进程通信核心

```
┌─────────────────────────────────────────────────────────────┐
│                       EVENT BUS                              │
│                                                             │
│  传输机制:                                                   │
│    Main Process  ←──── Electron IPC ────→  Renderer Process │
│    感知插件(Main)       双向桥接             UI + AI (Renderer) │
│                                                             │
│  感知事件 (Main → Renderer):                                 │
│    screen:captured     → AI Engine 分析截图                  │
│    clipboard:changed   → AI Engine 感知剪贴板内容            │
│    window:switched     → Behavior 判断是否需要响应           │
│    file:dropped        → AI Engine 分析文件                  │
│    user:idle(5min)     → Behavior 切换休眠状态               │
│                                                             │
│  AI 事件 (Renderer 内部):                                    │
│    ai:response         → Chat UI 显示回复                    │
│    ai:tool-call        → Tool Executor 执行工具              │
│    ai:proactive        → Chat UI 主动说话                    │
│                                                             │
│  交互事件 (Renderer → Main):                                 │
│    user:message        → AI Engine 处理输入                  │
│    user:drag           → Window Manager 移动窗口             │
│                                                             │
│  系统事件:                                                   │
│    app:startup         → Behavior 播放打招呼                 │
│    app:sleep           → Memory 存盘                         │
│    config:changed      → 各模块热更新配置                    │
└─────────────────────────────────────────────────────────────┘
```

---

## 版本演进路线

```
V1 (MVP - 2~3周)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  目标: 能聊天 + 有动画角色在桌面上

  Platform Layer  ✓ 透明窗口 + 托盘 + 全局快捷键唤出
  Presentation   ✓ 2D Lottie 动画（idle/happy/thinking/sleepy）
                 ✓ 聊天气泡 UI
  Core           ✓ 单 LLM API（云端）+ 短期记忆（内存，退出存盘）
                 ✓ SOUL.md 人格注入（基础版）
  Behavior       ✓ 基础状态机（idle/talking/sleeping）
  Perception     ✗ 无

V2 (工具与感知 - +3周)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  目标: 从聊天机器人进化为实用助手

  Core           + Tool Executor（LLM function calling）
                   - 总结、翻译、代码解释
                   - 文件/图片理解（拖入处理）
                 + 长期记忆（SQLite + 向量检索）
                 + 多 LLM Provider 切换
  Perception     + 活动窗口监听
                 + 剪贴板感知（用户触发）
                 + 文件拖拽接收
  Behavior       + Proactive Engine（低频、有价值时主动说话）
                   - 久坐提醒、开机问好
                   - 频率控制（1小时最多1次）

V3 (深度感知 - +4周)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  目标: 主动理解你在做什么

  Perception     + 截图理解（Vision API，用户控制开关）
                 + OCR 识别屏幕文字
  Core           + Agent Loop（观察→思考→行动→反馈）
                 + 更多工具（搜索、日程、待办管理）
  Behavior       + 智能主动交互（基于屏幕上下文判断时机）

V4 (3D 与语音 - +4周)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  目标: 从工具进化为伴侣

  Presentation   + 提取 Render Adapter 接口（此时才需要）
                 + 3D VRM 模型渲染
                 + 口型同步 + 表情 blendshape
  Core           + 语音输入（Whisper）
                 + 语音输出（TTS）
  Perception     + 面部追踪（可选）

V5 (生态 - 持续)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  目标: 社区驱动的开源生态

  全局           + 插件市场（社区贡献感知/工具/角色/皮肤）
                 + 官网 + 下载分发 + 自动更新
                 + 多设备同步（可选云端记忆）
                 + 自定义角色创建工具
                 + API 开放（第三方集成）
```

---

## 关键接口定义

```typescript
// ===== 事件总线（跨进程） =====
interface EventBus {
  emit(event: string, payload?: any): void
  on(event: string, handler: (payload: any) => void): void
  off(event: string, handler: (payload: any) => void): void
  // 内部自动处理 Main ↔ Renderer 的 IPC 转发
}

// ===== 感知插件接口 =====
// 运行在 Main Process
interface PerceptionPlugin {
  id: string
  name: string
  enabled: boolean          // 用户可控制开关
  init(): Promise<void>
  start(): void
  stop(): void
  // 所有感知结果通过 EventBus.emit() 发出
}

// ===== LLM Provider 接口 =====
interface LLMProvider {
  id: string
  name: string
  chat(messages: Message[], options?: LLMOptions): AsyncGenerator<string>
  embed?(text: string): Promise<number[]>
  vision?(image: Buffer, prompt: string): Promise<string>
}

// ===== 工具接口（V2 引入） =====
interface Tool {
  id: string
  name: string
  description: string       // 给 LLM 看的描述，用于 function calling
  parameters: JSONSchema    // 参数定义
  execute(params: any): Promise<ToolResult>
}

interface ToolResult {
  success: boolean
  content: string           // 返回给 LLM 的结果
  display?: string          // 可选：直接展示给用户的内容
}

// ===== 记忆接口 =====
interface MemoryStore {
  // 短期（内存持有，退出存盘）
  getRecentMessages(limit: number): Message[]
  addMessage(msg: Message): void
  flush(): Promise<void>    // 持久化到磁盘
  // 长期（V2）
  search(query: string, topK: number): MemoryEntry[]
  store(entry: MemoryEntry): void
  // 身份
  getIdentity(): Identity
  updateIdentity(patch: Partial<Identity>): void
}

// ===== 行为引擎接口 =====
interface BehaviorEngine {
  getCurrentState(): PetState  // idle | talking | sleeping
  transition(event: AppEvent): void
  shouldProactivelySpeak(): { should: boolean; reason?: string; cooldown: number }
}
```

---

## 目录结构

```
ai-pet/
├── electron/                    # Main Process
│   ├── main.ts                  # 入口
│   ├── window.ts                # 窗口管理（透明、置顶、拖拽）
│   ├── tray.ts                  # 托盘菜单
│   ├── hotkey.ts                # 全局快捷键
│   ├── ipc.ts                   # IPC 桥 → Event Bus 跨进程转发
│   └── perception/              # 感知插件（必须在 Main Process）
│       ├── interface.ts
│       ├── active-window.ts     # V2
│       ├── clipboard.ts         # V2
│       ├── screen-capture.ts    # V3
│       └── file-drop.ts         # V2（接收拖拽文件）
│
├── src/                         # Renderer Process
│   ├── core/
│   │   ├── event-bus.ts         # 事件总线（含 IPC 透传逻辑）
│   │   ├── ai/
│   │   │   ├── engine.ts        # AI 引擎主控
│   │   │   ├── providers/       # LLM 提供者
│   │   │   │   ├── interface.ts
│   │   │   │   ├── openai.ts
│   │   │   │   ├── claude.ts
│   │   │   │   └── ollama.ts
│   │   │   ├── prompt-builder.ts
│   │   │   └── tools/           # 工具系统（V2）
│   │   │       ├── interface.ts
│   │   │       ├── summarize.ts
│   │   │       ├── translate.ts
│   │   │       ├── read-file.ts
│   │   │       └── code-explain.ts
│   │   │
│   │   ├── memory/
│   │   │   ├── interface.ts
│   │   │   ├── short-term.ts    # 内存 + 退出时 JSON 存盘
│   │   │   ├── long-term.ts     # V2: SQLite + 向量
│   │   │   └── identity.ts      # SOUL.md 读写
│   │   │
│   │   └── behavior/
│   │       ├── state-machine.ts
│   │       └── proactive.ts     # V2
│   │
│   ├── renderer/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── Pet.tsx          # 角色容器 + Lottie
│   │   │   ├── ChatBubble.tsx
│   │   │   └── Settings.tsx
│   │   └── hooks/
│   │       ├── useChat.ts
│   │       └── usePetState.ts
│   │
│   └── shared/
│       ├── types.ts             # 全局类型定义
│       ├── constants.ts
│       └── utils.ts
│
├── data/
│   ├── SOUL.md                  # 角色人格定义
│   ├── memory.db                # SQLite（V2+）
│   └── config.json              # 用户配置
│
├── assets/
│   ├── animations/              # Lottie JSON
│   ├── models/                  # VRM 模型（V4+）
│   └── sounds/                  # 音效（可选）
│
├── plugins/                     # V5: 社区插件目录
├── website/                     # 官网（V5）
└── scripts/
    └── build.ts                 # 打包发布脚本
```

---

## 与原版的主要修正

| 修正点 | 原版 | 修正后 |
|--------|------|--------|
| Event Bus 归属 | 画在 Behavior Layer 内部 | 独立基础设施，明确跨进程机制 |
| Emotion Engine | 独立模块（多维情绪+衰减） | 移除，性格通过 SOUL.md + Prompt 实现 |
| Render Adapter | V1 就抽象 | V1 直接 Lottie，V4 需要时才提取接口 |
| Tool 系统 | Agent Loop 在 V3 才引入 | V2 引入 Tool Executor（function calling） |
| 感知插件位置 | 目录在 src/（Renderer） | 移到 electron/（Main Process） |
| 短期记忆存储 | "JSON 文件存储"（含义模糊） | 明确：内存持有，退出时存盘 |
| 职责边界 | State Machine vs Agent Loop 模糊 | 明确：SM 管状态，Agent Loop 管推理 |
| 产品定位 | 未说明 | 开头明确：开源 + 官网分发 + 本地优先 |
