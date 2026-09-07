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
- `process-transport.ts` 已提供实际传输层：宿主必须传入可信清单和绝对可执行文件授权列表；不通过 shell 解释命令，不继承应用密钥、PATH 或 Node 注入选项。
- 同时最多 32 个请求、单帧最多 1 MB，按请求 ID 对应响应并保留跨块 UTF-8；超时、取消、崩溃和协议错误终止当前进程并拒绝待处理请求。
- 故障后由宿主显式创建新连接，不自动重放写入操作；调用方应先用 `initialize` 协商 `protocolVersion: 1`。超时/取消不保证外部写入未发生，需要查询服务状态后再决定是否重试。
- 此层只隔离直接 helper 进程的故障，不是 OS 安全沙箱，不负责其自行派生的后台进程。可执行文件允许列表不能让任意脚本参数变安全，因此命令参数同样必须来自受信宿主。
- 已用真实 Node helper 验证乱序回复、中文分块、环境过滤、重复 ID、超时、崩溃、畸形/超大响应、取消及重新连接。未自动注册任意用户命令，也未宣称完成 Mem0 OSS 的实际接入。
- 外部插件分发仍需签名/脚本与目录授权、依赖安装和进程树治理，不能直接把此底层 API 开放给下载的未知插件。

## 后续扩展

当前注册表已经允许继续加入 Mem0 OSS、Letta 和轻量本地 Embedding。外部插件包的发现、安装、签名和依赖隔离尚未开放；在这些安全机制完成前，新服务能力仍以随应用发布的内置能力形式注册。
