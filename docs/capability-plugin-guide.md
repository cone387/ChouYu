# ChouYu 服务能力插件

`1.1.7` 起，ChouYu 将底层服务与斜杠命令插件分开管理。原有 `PluginDefinition` 继续负责 BBTalk 等可执行命令；服务能力插件负责记忆引擎和 Embedding，不会自动注册为 AI 工具。`1.1.8` 起，能力目录还会把当前选择、网络访问和记忆数据发送范围暴露给设置页诊断；`1.1.10` 起，AI Provider 和 Embedding 还会分别做可用性探测。

## 能力类型

- `memory-engine`：实现 `MemoryProvider`，负责本地存储、检索、历史和生命周期。
- `embedding`：实现批量 `embed()`，为本地记忆生成和查询向量。

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
| 记忆引擎 | `mem0-platform-engine` | Mem0 Platform 远程主记忆引擎 |
| 记忆引擎 | `mem0-self-hosted-engine` | Mem0 Self-hosted 远程主记忆引擎 |
| Embedding | `openai-compatible` | 调用兼容 `/embeddings` 的在线或本地服务 |

Embedding 默认不启用。若 Embedding 插件不可用或请求失败，SQLite 引擎仍会退回关键词检索。若配置的记忆引擎插件被移除，启动时会安全退回 `chouyu-sqlite`。

## 安全边界

- 能力只在 Electron Main Process 运行。
- Renderer 只接收安全的能力元数据，不接收工厂或内部对象。
- 密钥仍通过现有 `safeStorage` 链路保存。
- `sendsMemoryData` 必须在 UI 中显示明确的隐私提示。

## 进程隔离能力

对于 Mem0 OSS、Letta 或本地大模型等重型实现，建议通过 JSONL 进程边界接入，而不是直接打包进 Electron 主进程。`src/main/capabilities/process-bridge.ts` 定义了清单和请求/响应协议：

- helper 进程只接受带请求 ID 的 JSONL 消息。
- 清单必须声明命令、参数、工作目录、协议版本和超时。
- 当前版本只提供协议校验，不会自动执行用户指定命令。
- 后续启用时还需要签名校验、目录白名单、环境变量过滤和崩溃回退。

## 后续扩展

当前注册表已经允许继续加入 Mem0 OSS、Letta 和轻量本地 Embedding。外部插件包的发现、安装、签名和依赖隔离尚未开放；在这些安全机制完成前，新服务能力仍以随应用发布的内置能力形式注册。
