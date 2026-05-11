# V1 功能规格（MVP）

## 目标

用最小成本跑通核心体验：桌面上有一个可爱的角色，按快捷键唤出输入框跟它聊天，它有自己的性格。

**技术栈：** React + TypeScript + Vite + Electron

**预计工期：** 2~3 周

---

## 功能清单

### 1. 桌面窗口

| 项目 | 规格 |
|------|------|
| 窗口类型 | 透明无边框窗口（frameless + transparent） |
| 置顶行为 | 始终置顶（alwaysOnTop） |
| 拖拽 | 鼠标拖拽角色可自由移动 |
| 吸附 | 拖到屏幕边缘时自动吸附（snap to edge） |
| 点击穿透 | 角色区域可交互，透明区域点击穿透到下方窗口 |
| 初始位置 | 右下角（距底部和右侧各 100px） |
| 记忆位置 | 退出时保存位置，下次启动恢复 |

### 2. 托盘

| 项目 | 规格 |
|------|------|
| 图标 | 简单的角色头像 icon |
| 右键菜单 | 显示/隐藏、设置、退出 |
| 双击 | 显示/隐藏切换 |

### 3. 全局快捷键

| 快捷键 | 行为 |
|--------|------|
| `Alt+Space`（可自定义） | 弹出/收起聊天输入框 |
| `Esc` | 收起输入框 |

### 4. 聊天交互

#### 4.1 输入框

- 快捷键触发后，在角色旁边弹出输入框
- 输入框样式：圆角、半透明背景、简洁
- 支持多行输入（Shift+Enter 换行，Enter 发送）
- 发送后输入框保留（方便连续对话），Esc 收起

#### 4.2 对话气泡

- AI 回复以气泡形式显示在角色上方/旁边
- 支持 Markdown 渲染（代码块、加粗、列表等）
- 流式输出（逐字显示）
- 气泡自动消失（10 秒无操作后渐隐，点击可固定）
- 历史记录：最近的对话在气泡区域可滚动查看

#### 4.3 对话逻辑

- 短期记忆：保留最近 30 轮对话作为上下文
- 运行时在内存中，退出时存到本地 JSON 文件
- 启动时加载上次的对话记录

### 5. AI 能力

| 项目 | 规格 |
|------|------|
| 默认 Provider | OpenAI（gpt-4o） |
| 备选 | Claude（sonnet） |
| API Key 配置 | 设置面板中填入，存储在本地 config |
| 人格注入 | 读取 `data/SOUL.md` 作为 system prompt |
| 流式输出 | 使用 streaming API，逐 token 显示 |

### 6. 角色动画（极简版）

V1 用 CSS/SVG 动画实现，不依赖 Lottie 库，降低复杂度。

#### 状态与动画

| 状态 | 动画表现 |
|------|----------|
| idle | 轻微上下浮动 + 眨眼 |
| thinking | 旋转/跳动的思考指示 |
| talking | 简单的嘴巴开合或弹跳 |
| sleeping | 缩小 + ZZZ 气泡 |
| happy | 短暂弹跳/放大效果（收到消息时） |

#### 角色外观

- V1 用一个简单的 SVG 角色（圆形头 + 表情）
- 后续可替换为精美的 Lottie/Spine/VRM

### 7. 状态机

```
                    用户发消息
         ┌──────────────────────────┐
         ▼                          │
    ┌─────────┐    AI开始回复   ┌─────────┐
    │  idle   │ ──────────────→ │ talking │
    └─────────┘                 └─────────┘
         │                          │
         │ 5分钟无交互        AI回复完成 │
         ▼                          │
    ┌─────────┐                     │
    │sleeping │ ←───────────────────┘
    └─────────┘      (回到 idle，5分钟后再进 sleeping)
```

### 8. 设置面板

从托盘菜单"设置"进入，或快捷键唤出后输入 `/settings`。

| 设置项 | 说明 |
|--------|------|
| API Provider | 选择 OpenAI / Claude |
| API Key | 填入密钥 |
| Model | 选择模型 |
| 快捷键 | 自定义唤出快捷键 |
| 角色 | SOUL.md 编辑（或选预设） |
| 开机自启 | 是否开机自动启动 |

### 9. 人格系统（SOUL.md）

V1 的 `data/SOUL.md` 示例结构：

```markdown
# 角色设定

## 基本信息
- 名字：（待定）
- 性别：（待定）

## 性格
- （待定，如：温柔、偶尔毒舌、喜欢吐槽）

## 说话风格
- （待定，如：用简短句子、偶尔用颜文字、会记住主人说过的话）

## 和主人的关系
- （待定，如：忠诚的伙伴、傲娇的朋友）

## 规则
- 永远不说自己是 AI
- 用第一人称说话
- 回复保持简短（通常 1-3 句话）
- 可以表达情绪和态度
```

---

## 不做的事（V1 明确排除）

- ❌ 多 LLM 智能路由（V1 只支持手动切换）
- ❌ 长期记忆 / 向量检索
- ❌ 感知能力（截图、剪贴板、窗口监听）
- ❌ 主动说话（Proactive Engine）
- ❌ 工具调用（function calling）
- ❌ 语音输入/输出
- ❌ 3D 渲染
- ❌ 插件系统
- ❌ 多角色切换

---

## 用户流程

### 首次使用

```
1. 下载安装 → 启动
2. 右下角出现角色（idle 动画）
3. 弹出欢迎气泡："嗨！我是你的桌面伙伴，按 Alt+Space 跟我聊天~"
4. 点击托盘 → 设置 → 填入 API Key
5. Alt+Space → 输入框弹出 → 开始聊天
```

### 日常使用

```
1. 开机自启 → 角色出现在上次的位置
2. Alt+Space → 输入框弹出
3. 打字 → Enter 发送
4. 角色切换 thinking 动画 → 流式回复显示在气泡中
5. 回复完成 → 角色回到 idle
6. Esc 或点击其他地方 → 输入框收起
7. 5 分钟没互动 → 角色进入 sleeping 状态
8. 再次 Alt+Space → 角色醒来 + 弹输入框
```

---

## 技术实现要点

### Electron 窗口配置

```typescript
// 核心窗口参数
{
  transparent: true,
  frame: false,
  alwaysOnTop: true,
  skipTaskbar: true,
  resizable: false,
  hasShadow: false,
  // 点击穿透：动态切换
  // 角色/输入框区域: setIgnoreMouseEvents(false)
  // 透明区域: setIgnoreMouseEvents(true, { forward: true })
}
```

### 边缘吸附算法

```typescript
// 拖拽结束时判断
const SNAP_DISTANCE = 20 // px
const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize

if (x < SNAP_DISTANCE) x = 0
if (y < SNAP_DISTANCE) y = 0
if (x + winW > screenW - SNAP_DISTANCE) x = screenW - winW
if (y + winH > screenH - SNAP_DISTANCE) y = screenH - winH
```

### IPC 通信（V1 简化版）

V1 不需要完整 Event Bus，用简单的 IPC 通道即可：

```
Main Process                    Renderer Process
─────────────                   ─────────────────
hotkey:triggered  ────────→     显示/隐藏输入框
window:move       ←────────     用户拖拽角色
window:position   ────────→     吸附后的最终位置
config:get/set    ←──────→     读写配置
memory:load/save  ←──────→     加载/保存对话记录
```

### 文件结构（V1 实际需要的）

```
ai-pet/
├── electron/
│   ├── main.ts              # Electron 入口
│   ├── window.ts            # 窗口管理 + 吸附逻辑
│   ├── tray.ts              # 托盘
│   ├── hotkey.ts            # 全局快捷键注册
│   └── ipc.ts              # IPC handler
│
├── src/
│   ├── App.tsx              # 根组件
│   ├── components/
│   │   ├── Pet.tsx          # 角色 + SVG 动画
│   │   ├── ChatBubble.tsx   # 对话气泡
│   │   ├── ChatInput.tsx    # 输入框
│   │   └── Settings.tsx     # 设置面板
│   ├── core/
│   │   ├── ai-engine.ts     # AI 调用（流式）
│   │   ├── memory.ts        # 短期记忆（内存 + JSON 持久化）
│   │   ├── prompt-builder.ts # 组装 system prompt
│   │   └── state-machine.ts # 状态机
│   ├── hooks/
│   │   ├── useChat.ts       # 聊天逻辑 hook
│   │   └── usePetState.ts   # 角色状态 hook
│   ├── shared/
│   │   ├── types.ts
│   │   └── constants.ts
│   └── styles/
│       └── index.css
│
├── data/
│   ├── SOUL.md              # 角色人格
│   └── config.json          # 用户配置（API key 等）
│
├── assets/
│   └── icon.png             # 托盘图标
│
├── package.json
├── tsconfig.json
├── vite.config.ts
├── electron-builder.json    # 打包配置
└── README.md
```

---

## 验收标准

V1 完成的定义：

- [ ] 启动后桌面出现角色，有 idle 浮动动画
- [ ] 可自由拖拽，到边缘自动吸附
- [ ] Alt+Space 弹出输入框，Esc 收起
- [ ] 输入文字后 AI 流式回复，显示在气泡中
- [ ] 角色根据状态切换动画（idle/thinking/talking/sleeping）
- [ ] 对话有记忆（关闭重开后能接着聊）
- [ ] 通过 SOUL.md 控制角色性格和说话风格
- [ ] 托盘右键可退出/设置
- [ ] 设置中可配置 API Key 和模型
- [ ] 可打包为 Windows 安装包
