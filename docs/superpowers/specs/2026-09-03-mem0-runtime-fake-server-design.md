# Mem0 主引擎 Electron Runtime 冒烟测试设计

- 日期：2026-09-03
- 状态：设计已评审通过，待实现
- 对应路线图：`docs/roadmap.md` P1.5 最后一项「用 Electron runtime fake server 覆盖 Mem0 主引擎连接和错误恢复」

## 背景与动机

- Mem0 已是可选主记忆引擎（Self-hosted / Platform），Mem0 模式下聊天检索直接走远程 `/memories/search`，SQLite 仅作实现缓存。
- 适配器层（`src/main/memory/sync/mem0-adapter.ts`）已有注入式 fetch 单测：列表、搜索、鉴权、超时、离线和异常响应。
- 缺口：真实 Electron 主进程里「选择 Mem0 引擎 → 真实 HTTP 请求 → 服务故障 → 恢复」整条链路没有自动化验证；最近的 fallback 修复（搜索端点不可用时退回列表召回）也没有 runtime 保护。
- 现有冒烟架构：`scripts/smoke-electron.js` spawn Electron（临时 userData + `CHOUYU_SMOKE_TEST=1`），主进程 `whenReady` 内嵌断言块，renderer 就绪后输出 `CHOUYU_SMOKE_READY`，外部脚本再校验磁盘产物。

## 目标

在现有 Electron 冒烟测试内，用本地 fake Mem0 server 覆盖 Mem0 主引擎全生命周期：引擎切换、连接测试、聊天检索、写入、三类故障场景与恢复。

## 范围决策

| 决策点 | 结论 |
|--------|------|
| 覆盖范围 | 全生命周期：连接 + 检索 + 写入 + 故障 + 恢复 |
| 运行位置 | 并入现有 `scripts/smoke-electron.js` 冒烟；CI 每次必跑，`test:smoke:packaged` 自动覆盖 |
| 故障场景 | 401 认证失败、搜索端点 404 → 列表兜底、连接掐断 + 恢复 |
| 超时模拟 | 不做。真实超时需 30 秒以上，拖慢冒烟；该路径已有单测覆盖 |
| Mem0 模式 | 仅 self-hosted（X-API-Key + localhost，即文档化部署形态）。platform 与其差异只有鉴权头和 Base URL，由单测覆盖 |
| fake server 位置 | 内嵌主进程模块（评审选定的方案 1）：零新增环境变量、零跨进程协议，loopback 上仍是真 TCP + 真 fetch + 真 Electron 运行时 |

## 组件设计

### 1. `src/main/smoke/fake-mem0-server.ts`

假 Mem0 self-hosted HTTP 服务，纯 Node `http`，监听 `127.0.0.1:0`（随机端口）。

- 端点（self-hosted 语义）：
  - `GET /memories?user_id=...&page_size=...` — 按 `user_id` 过滤返回内存存储中的记录
  - `POST /memories/search`（含 `/memories/search/`、`/search`、`/search/` 变体）— 简单子串匹配
  - `POST /memories` — 写入：解析 `messages[]`、`infer`、`metadata`，追加记录并返回 `[{id, memory, metadata}]`
- 故障模式 `setMode(mode)`：
  - `ok` — 正常响应
  - `auth` — 一律 401
  - `search-missing` — 所有搜索路径 404（列表与写入仍正常）
  - `refuse` — 直接 `destroy()` 掐断 socket（客户端立即收到连接错误，不会等到 30 秒 AbortSignal 超时）
- 请求日志：记录方法、路径、`X-API-Key` 头、解析后的 body，供断言（鉴权头存在、`infer` 标志、`user_id` 隔离）
- 种子数据：smoke 用户 2 条 + 其他用户 1 条，用于验证 user_id 隔离

### 2. `src/main/smoke/mem0-smoke.ts`

导出 `runMem0RuntimeSmoke(): Promise<void>`，编排整个 Mem0 阶段。失败时按现有惯例 `throw new Error('... smoke test failed')`。

### 3. `src/main/index.ts` 接线

- 现有 SQLite 冒烟块之后追加 `await runMem0RuntimeSmoke()`。
- 顺手修一个现有缺陷：把 `isSmokeTest` 断言块整体包 try/catch，失败时输出 `CHOUYU_SMOKE_FAILED` 并 `app.exit(1)`。当前主进程断言失败只会让 `whenReady` 的 Promise 挂掉，窗口永远不创建，外部脚本要等满 20 秒超时才能报错，且错误信息不明确。

## 运行序列（主进程内，真 fetch → 真 loopback TCP）

1. 启动 fake server 并写入种子数据。
2. `saveConfig` 切引擎为 `mem0-self-hosted-engine`，baseUrl / apiKey / userId 指向 fake server → `closeMemory()` + `initializeMemory()`（`service.ts` 已支持该重初始化模式）。
3. 断言 provider 为 `Mem0MemoryProvider`，能力目录中该引擎 active 且唯一。
4. **连接**：`testMemoryEngine()` 返回 ok，`remoteCount` 等于 smoke 用户种子数。
5. **聊天检索**：`searchMemories()` 返回种子记忆；SQLite 实现缓存收到该记录；请求日志确认走了 search 端点且带 X-API-Key。
6. **写入**：`rememberRaw()` 立即生效（fake server 存储增长、返回记录被缓存）；`createActive()` 走 fire-and-forget push，轮询 fake server（每 100ms 一次，上限 2 秒）确认收到 `infer: false` 且 metadata 带 `chouyu_id`。
7. **故障矩阵**（见下节，依次切换三种模式断言）。
8. **恢复**：切回 `ok`，`testMemoryEngine()` 再次 ok，检索恢复正常。
9. **收尾**：`closeMemory()` → `saveConfig` 切回 `chouyu-sqlite` → `initializeMemory()` → 关闭 fake server。

## 故障矩阵

| 模式 | 断言 |
|------|------|
| `auth`（401） | `testMemoryEngine()` ok:false 且消息含「认证失败」；`searchMemories()` 以同样归一化的错误 reject（生产路径由 ChatPanel 捕获并降级为空记忆 + 提示，这里钉住 service 层行为） |
| `search-missing`（搜索 404） | `searchMemories()` 仍成功——适配器退回列表接口用本地相似度排序召回（即「搜索不可用退回列表」修复的路径） |
| `refuse`（掐断连接） | `testMemoryEngine()` ok:false 消息含「无法连接」；`searchMemories()` reject 且错误不是原始 ECONNRESET 文本 |

## 错误处理

- 阶段内所有断言失败 throw 带上下文的错误，由 index.ts 的 try/catch 转成 `CHOUYU_SMOKE_FAILED` + `app.exit(1)`，外部脚本立即以非零码结束。
- fire-and-forget 写入失败在生产中只 `console.warn`（不阻塞聊天）；冒烟里通过轮询 fake server 状态，在 2 秒上限内确认到达，超时视为失败。
- 阶段结束时无论成败都恢复 SQLite 引擎并关闭 fake server（fake server 在 try/finally 中关闭）。

## 验证与性能

- fake server 自身配少量 vitest：路由分发、模式切换、user_id 过滤——保证测试装置不悄悄坏掉。
- `smoke-electron.js` 的 `TIMEOUT_MS` 从 20 秒提到 30 秒留余量；Mem0 阶段全 loopback，预计增加 1–3 秒。
- 完成后：勾掉 `docs/roadmap.md` P1.5 最后一项，更新 `docs/current-status.md` 工程验证段落。
- 质量门禁照旧：typecheck、vitest、build、`test:smoke:built` 全绿才算完成。

## 明确不做（YAGNI）

- platform 模式的运行时覆盖
- 真实 30 秒超时模拟
- Mem0 OSS 运行时 / 外部 helper 进程（属 P3）
- 渲染层 UI 交互验证（属 P1 的 Electron UI 冒烟项）
