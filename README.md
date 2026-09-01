# ChouYu（丑鱼）

一个住在桌面上的有性格的 AI 助手。平时安静待着，需要时快捷键唤出帮你干活。

## 特性

- 🐟 桌面悬浮角色，有自己的性格和说话风格
- 💬 AI 对话，支持流式输出和 Markdown 渲染
- 🧠 对话记忆，关闭重开后能接着聊
- 🗂️ 多会话工作区，支持搜索、重命名、删除和 Markdown 导出
- 🔌 插件系统，可接入外部服务（BBTalk、翻译等）
- 📸 截图并发送给支持视觉能力的模型
- 🖥️ 选择窗口或屏幕，快捷进行文字识别、总结和翻译
- 🛠️ AI 工具调用，敏感操作逐次授权并显示执行时间线
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

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 打包 Windows 安装包
npm run package:win
```

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

- [系统架构](docs/architecture.md)
- [V1 功能规格](docs/v1-spec.md)
- [当前功能状态](docs/current-status.md)
- [迭代路线与发布验收](docs/roadmap.md)
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
