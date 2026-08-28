# ChouYu 服务能力插件

`1.1.7` 起，ChouYu 将底层服务与斜杠命令插件分开管理。原有 `PluginDefinition` 继续负责 BBTalk 等可执行命令；服务能力插件负责记忆引擎、Embedding 和记忆同步，不会自动注册为 AI 工具。

## 能力类型

- `memory-engine`：实现 `MemoryProvider`，负责本地存储、检索、历史和生命周期。
- `embedding`：实现批量 `embed()`，为本地记忆生成和查询向量。
- `memory-sync`：实现远程连接测试、列出和显式上传，不替换本地主数据源。

每个能力声明：

- 稳定 ID、名称和说明
- 是否需要网络
- 是否会发送记忆内容
- 是否需要额外配置
- 对应运行时工厂

注册表位于 `src/main/capabilities/registry.ts`，内置能力在 `src/main/capabilities/builtins.ts` 注册。

## 当前内置能力

| 类型 | ID | 说明 |
|---|---|---|
| 记忆引擎 | `chouyu-sqlite` | 完全本地，默认启用 |
| Embedding | `openai-compatible` | 调用兼容 `/embeddings` 的在线或本地服务 |
| 记忆同步 | `mem0-platform` | Mem0 托管平台，使用 Token 鉴权 |
| 记忆同步 | `mem0-self-hosted` | Mem0 自托管 Server，使用 `X-API-Key` 或本地关闭鉴权 |

Embedding 和同步能力默认不启用。若 Embedding 插件不可用或请求失败，SQLite 引擎仍会退回关键词检索。若配置的记忆引擎插件被移除，启动时会安全退回 `chouyu-sqlite`。

## 安全边界

- 能力只在 Electron Main Process 运行。
- Renderer 只接收安全的能力元数据，不接收工厂或内部对象。
- 密钥仍通过现有 `safeStorage` 链路保存。
- `sendsMemoryData` 必须在 UI 中显示明确的隐私提示。
- 远程上传必须由用户显式触发；注册能力本身不能扩大授权范围。

## 后续扩展

当前注册表已经允许继续加入 Mem0 OSS、Letta 和轻量本地 Embedding。外部插件包的发现、安装、签名和依赖隔离尚未开放；在这些安全机制完成前，新服务能力仍以随应用发布的内置插件形式注册。
