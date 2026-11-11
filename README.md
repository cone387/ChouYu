# ChouYu（丑鱼）— 开源桌面 AI 助手

**陪你工作，持续交付，也帮你记住一天的来龙去脉。**

ChouYu 是一个有性格的桌面 AI 助手，集 **24h 主动工作、活动记录、多联系人协作与长期记忆** 于一体。你可以把研究、写作和评审交给联系人持续推进，回看电脑上的活动与关键画面，再由 ChouYu 提醒你关注新的成果和需要处理的问题。

[下载安装](https://github.com/cone387/ChouYu/releases/latest) · [核心特色](#核心特色) · [开始使用](#开始使用) · [当前功能与限制](docs/current-status.md) · [开发文档](#文档)

ChouYu is an open-source desktop AI assistant and companion with ongoing background work, local activity recording, multi-agent collaboration, and long-term memory. Background work requires the app to stay running on an awake computer and the configured model service to be available.

## 核心特色

### 24h 主动工作，持续交付成果

用自然语言把任务交给联系人，让它按连续、间隔或定时安排推进研究、写作、创意和评审。每轮成果保留正文、来源和历史版本，并按通知设置主动送到聊天；你可以补充要求、提出修改意见，或暂停某一项任务。

“24h”指可设置全天持续工作，没有指定终点的任务不会因为交付一条 idea 或完成一次评审就自动结束。电脑须保持唤醒、应用须持续运行，并配置可用的模型服务；执行仍受工作时段、权限、额度和必要答复限制。退出应用、关机或休眠期间不运行，也不承诺全天无故障。[持续工作说明](docs/contact-topics.md) · [执行与恢复架构](docs/contact-agents-architecture.md)

### 活动记录，把工作过程变成可找回的线索

记录前台应用、窗口标题和关键画面，在本机通过 OCR 识别文字。支持按日期和应用回看、跨日关键词搜索、可选语义查找，以及带来源引用的事项总结和问答，帮助你找回看过的内容、梳理做过的事情。还可以保存画面书签或接续卡，下次从“接着做”继续。

活动、画面和 OCR 默认开启，可随时暂停、关闭或排除指定应用。采集与 OCR 在本地完成；手动使用 AI 总结、问答或语义查找时，相关文字会发送至你配置的模型或 Embedding 服务。活动时长是采样估计，不等同于精确工时。[工作日志说明](docs/work-journal.md)

### 多联系人协作，各自保留人设、记忆与成果

为不同联系人配置独立的人设、记忆、资料、技能和工作设置。例如让一位联系人持续写作，另一位在获得授权后读取已保存的作品并评审。成果保留固定版本与来源；已确认的持续交接可跟随相关正文更新，在各自权限和调度条件内推进。[联系人协作架构](docs/contact-agents-architecture.md)

### 有陪伴感的专属助手

ChouYu 住在桌面上，支持问候、休息提醒、回来提示和自然语言安排的晨报。每日问候和回来时可以先检查联系人的真实工作状态，提醒你查看新成果、失败原因或待回复的问题；主动消息保留未读提示和托盘闪烁。[主动服务与晨报](docs/contact-task-spec.md#7-chouyu-主动服务与晨报)

### 长期记忆与可扩展工具

聊天与联系人工作可以参考长期记忆，支持来源追溯、纠正、遗忘和版本回看；可按需配置 Embedding 检索。工具、插件和按联系人启用的技能用于扩展能力，仍遵守各自授权与资源限制。[记忆说明](docs/memory-guide.md) · [工具说明](docs/tool-guide.md) · [联系人技能](docs/contact-skills-20261010.md)

## 下载与开始使用

### 下载

前往 [最新版本 Releases](https://github.com/cone387/ChouYu/releases/latest) 下载安装包，无需先安装 Node.js 或自行编译：

- **Windows**：选择 `ChouYu-Setup-版本号.exe`。
- **macOS**：选择 `ChouYu-版本号-universal.dmg`，也提供 ZIP 包。

当前正式版为 **v1.4.5**，减少 Windows 安装包中的冗余依赖文件，并新增真实安装后的完整性校验；沿用旧版长路径升级修复。更新内容与已知限制见 [发布说明](docs/releases/v1.4.5.md)。模型服务需要自行配置，费用按所选服务计算；平台相关能力及验证范围见 [当前状态](docs/current-status.md)。

### 开始使用

1. 安装并启动 ChouYu，在设置中配置 AI Provider、模型和 API Key。
2. 查看工作日志的记录范围，根据需要调整画面、OCR、排除应用与保留期限。
3. 打开桌面角色或使用 `Alt+Space` 唤出聊天，把具体事项交给联系人。
4. 需要持续工作时，在联系人工作设置中选择工作方式、时段与额度，并保持电脑唤醒、应用运行。

## 更多功能

<details>
<summary>展开完整功能清单</summary>

- 📒 工作日志：默认开启本地活动、前台画面与 OCR，新配置采用 10 秒目标间隔、10 GB 画面配额，支持可选自动清理、事项总结和跨日问答；可随时暂停，见[使用说明](docs/work-journal.md)

- 🐟 桌面悬浮角色，有自己的性格和说话风格
- 💬 AI 对话，支持流式输出和 Markdown 渲染
- 🧑‍💻 联系人持续工作：在聊天中交付事项，后台按预算持续研究或写作，保留独立记忆、成果版本和来源；基于 LangGraph，需保持应用运行，见[使用说明](docs/contact-topics.md)与[24h 工作架构](docs/contact-agents-architecture.md)
- 🧠 对话记忆，关闭重开后能接着聊
- 💾 聊天历史不再按数量静默截断，图片独立保存，损坏文件保留并尝试备份恢复
- 🗂️ 多会话工作区，支持搜索、重命名、删除和 Markdown 导出
- 🔌 插件系统，可接入外部服务（BBTalk、翻译等）
- 📸 截图并发送给支持视觉能力的模型
- 🖥️ 选择窗口或屏幕，快捷进行文字识别、总结和翻译
- 🛠️ AI 工具调用，按系统与联系人确认策略处理授权，并显示执行时间线
- 🧩 插件自动接入 AI 工具目录，并支持逐工具启用和风险说明
- 🧠 本地长期记忆，候选确认、相关检索和记忆来源可追溯
- 🔎 可选 Embedding Provider，支持关键词与向量混合检索
- ⚖️ 记忆矛盾检测、替换/并存决策和可恢复版本历史
- ♻️ 记忆有效期、容量预算、批量整理和来源反馈学习
- 🧩 主题聚类与可追溯摘要压缩，减少 Prompt 占用
- 🧭 人工主题校正、冲突导入预览、单条有效期和本地统计概览
- 🗃️ Memory Explorer 记忆库视图：搜索、筛选、排序和卡片内增删改查
- 🪟 设置面板自适应窗口大小，内容区独立滚动不再拥挤
- ↔️ 设置面板优先横向展开，适合记忆卡片和能力诊断内容
- ☁️ 可选 Mem0 远程适配器，显式上传、拉取预览且本地 SQLite 始终可用
- 🧱 服务能力插件，可独立选择记忆引擎、Embedding 和同步实现
- ↔️ 聊天内容自适应换行，代码、长链接和附件不会制造横向滚动
- 🩺 Provider 与 Embedding 分开诊断，配置缺失时明确阻止发送
- 🧰 能力中心统一查看本地/联网能力与数据边界
- 🎨 在设置中直接编辑 SOUL.md 角色人格
- 🌗 手动亮/暗主题切换，也可以跟随系统
- 🎨 默认中性配色参考桌面 ChatGPT：灰蓝外框、近白侧栏、黑白主操作，仅调整颜色，保留原字体与布局。在「设置 → 通用 → 配色主题」选择「中性（ChatGPT 风格）」；已有彩色配色保持原选择。
- 🔍 设置项级搜索，输入关键词直达具体设置字段
- 🌈 代码块语法高亮，输入框支持 ↑/↓ 翻历史消息

</details>

## 从源码运行

开发环境使用 Node.js 24（见 `.nvmrc`）。当前代码版本为 `1.4.5`，更新内容见 [发布说明](docs/releases/v1.4.5.md)，功能与验证边界见 [当前状态](docs/current-status.md) 和 [桌面与阅读验收](docs/desktop-release-reading-acceptance-20261109.md)。历史候选包记录不代表当前构建。Windows 图片附件支持[离线文字识别](docs/offline-ocr.md)。

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 质量检查
npm run typecheck
npm test
npm run test:memory-eval
npm run test:smoke

# 真实窗口采集验收（需要交互桌面；macOS 需要录屏权限）
npm run test:smoke:capture

# 打包 Windows 安装包
npm run package:win
```

普通冒烟测试使用隔离测试窗口的合成画面，覆盖界面、存储、OCR 索引和活动记录流程，不依赖录屏权限。`test:smoke:capture` 单独检查真实窗口采集、连续采集和资源释放；权限不足时会明确失败并提示处理方法。原有 `CHOUYU_SMOKE_SYNTHETIC_CAPTURE` 环境变量不再需要。

## 使用

1. 启动后桌面右下角出现丑鱼角色
2. 按 `Alt+Space` 唤出聊天面板
3. 在设置中配置 AI Provider 和 API Key
4. 开始聊天

API Key 和插件 Token 使用 Electron `safeStorage` 加密后保存在本机；剪贴板感知默认关闭，可在“设置 → 通用”中主动开启。

### 斜杠命令

| 命令 | 说明 |
|------|------|
| `/new` | 新建对话 |
| `/clear` | 清空当前对话（需要确认） |
| `/remember 内容` | 创建长期记忆候选（确认后生效） |
| `/memory` | 打开独立记忆工作区 |
| `/settings` | 打开设置 |
| `/model` | 打开模型选择器 |
| `/model 模型名` | 直接切换到指定模型 |
| `/help` | 查看帮助 |
| `/bb 内容` | 发布碎碎念到 BBTalk（需先登录） |

### 插件

ChouYu 支持通过插件接入外部服务。内置插件：

- **BBTalk** — 快速发布碎碎念到 BBTalk 微博客系统

插件使用方式：
- 斜杠命令：`/bb 今天天气真好`
- 工具栏按钮：点击 📝 进入 BBTalk 模式，输入内容后发送

开发新插件请参考 [插件开发指南](docs/plugin-guide.md)。

## 技术栈

- Electron + React + TypeScript
- electron-vite 构建
- 本地 JSON + SQLite 存储

## 项目结构

```
src/
├── main/                    # Electron 主进程
│   ├── index.ts             # 入口
│   ├── database.ts          # 本地存储
│   ├── ipc.ts               # IPC 通信
│   ├── tray.ts              # 托盘
│   ├── hotkey.ts            # 全局快捷键
│   └── plugins/             # 插件系统
│       ├── types.ts         # 插件接口定义
│       ├── registry.ts      # 插件注册表
│       └── bbtalk/          # BBTalk 插件
├── preload/                 # Preload bridge
└── renderer/                # React UI
    └── src/
        ├── components/      # 组件
        ├── core/            # AI 引擎、记忆、状态机
        └── shared/          # 类型、常量
```

## 文档

- [联系人任务产品与交互规范（现行 spec）](docs/contact-task-spec.md)

- [系统与模块架构图册（18 张）](docs/architecture-atlas/README.md)
- [早期架构规划](docs/architecture.md)
- [联系人持续工作与 24h 实验架构](docs/contact-agents-architecture.md)
- [V1 功能规格](docs/v1-spec.md)
- [当前功能状态](docs/current-status.md)
- [迭代路线与发布验收](docs/roadmap.md)
- [聊天数据保存与恢复](docs/storage-recovery.md)
- [1.1.15 发布检查清单](docs/release-checklist-v1.1.15.md)
- [插件开发指南](docs/plugin-guide.md)
- [工具系统指南](docs/tool-guide.md)
- [记忆系统指南](docs/memory-guide.md)
- [服务能力插件指南](docs/capability-plugin-guide.md)

## 开发

```bash
# 类型检查
npm run typecheck

# 运行测试
npm run test

# 构建
npm run build
```

提交到 `master` 或创建 Pull Request 时，CI 会自动执行类型检查、测试和生产构建；发布标签只有在质量检查通过后才会继续打包。

## License

MIT
