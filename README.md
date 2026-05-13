# ChouYu（丑鱼）

一个住在桌面上的有性格的 AI 助手。平时安静待着，需要时快捷键唤出帮你干活。

## 特性

- 🐟 桌面悬浮角色，有自己的性格和说话风格
- 💬 AI 对话，支持流式输出和 Markdown 渲染
- 🧠 对话记忆，关闭重开后能接着聊
- 🔌 插件系统，可接入外部服务（BBTalk、翻译等）
- 📸 截图识别（开发中）
- 🎨 可自定义角色人格（SOUL.md）

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

### 斜杠命令

| 命令 | 说明 |
|------|------|
| `/clear` | 清空对话 |
| `/settings` | 打开设置 |
| `/model` | 切换模型 |
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
- 本地 JSON 存储

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
- [插件开发指南](docs/plugin-guide.md)

## 开发

```bash
# 类型检查
npm run typecheck

# 运行测试
npm run test

# 构建
npm run build
```

## License

MIT
