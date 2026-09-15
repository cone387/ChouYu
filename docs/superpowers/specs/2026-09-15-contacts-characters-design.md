# AI 角色与通讯录（2026-09-15）

## 背景与决策

参考 OpenAgentCouncil 的联系人导航，为 ChouYu 增加多 AI 角色聊天能力与通讯录入口。与用户确认的关键决策：

1. **角色 = 完整人设 + 各自模型**：名字 + emoji 头像 + 人设提示词（独立 soulMd）+ 供应商档案引用 + 模型名。
2. **导航形态**：工作区新增顶级「通讯录」页（`WorkspacePage` 加 `'contacts'`，与 tasks 页同模式），不做聊天页内侧栏切换。
3. **会话归属**：每角色独立会话列表；现有会话一次性迁移归入内置默认角色「丑鱼」。
4. **桌宠形象不变**：角色只存在于工作区聊天面板，桌宠本体始终是丑鱼。
5. **模型配置**：设置页支持多个具名供应商档案（base URL + key 存一份），角色只引用档案 + 选模型名；不做角色内嵌 key。
6. **交付分两期**：一期交付完整纵切（档案、角色 CRUD、会话绑定、聊天链路解析、通讯录页）；二期做分组/置顶/未读计数、头像图片上传、角色导入导出。

现状可复用先例：`src/shared/config.ts` 的 `AppConfig`/`normalizeConfig`/`sanitizeConfigPatch`（单供应商配置与字段校验模式）；`src/main/database.ts` 的 `StoreData`/`STORE_VERSION` 版本链与加密前缀；`WorkspaceNav.tsx` 的 `WorkspacePage` 页面注册；`ChatPanel.tsx` 的页面挂载分发；tasks 模块的 `electronAPI.*` IPC + `chouyu:*-changed` 事件模式。

OpenAgentCouncil 参考点（`web/src/App.tsx` 的 `activeNav` 状态、`ContactGroupColumn`/`ContactListColumn` 分组列）：仅取「列表浏览 → 点击开聊」交互语义，不搬其多 Agent 群聊数据模型。

## 数据模型与存储

### 供应商档案（`AppConfig` 新字段，`src/shared/config.ts`）

```ts
interface ProviderProfile {
  id: string          // 稳定 id；首个档案即「默认档案」
  name: string        // 具名，如「默认」「公司中转」
  provider: 'openai' | 'claude'
  baseUrl: string
  apiKey: string
}
// AppConfig 新增：providerProfiles: ProviderProfile[]
```

- **零迁移策略**：读取时若 `providerProfiles` 为空，从 legacy `provider/baseUrl/apiKey` 合成名为「默认」的档案；legacy 字段保留不动，作为非聊天场景（主动问候、模型诊断等）的默认档案来源，直至二期评估移除。
- 档案 apiKey 沿用现有加密存储方式；`normalizeConfig`/`sanitizeConfigPatch` 增加档案列表的逐字段校验（name/model 长度、provider 枚举、去重）。

### 角色（JSON 主库，`src/main/database.ts` 的 `StoreData.characters`）

```ts
interface Character {
  id: string
  name: string        // 非空、去重（与现有角色名不重复）
  avatar: string      // 一期仅 emoji 或名字首字，不做图片上传
  soulMd: string      // 人设提示词，独立于全局 soulMd
  providerProfileId: string
  model: string
  builtIn?: boolean   // 默认角色「丑鱼」，唯一且不可删除
  createdAt: number
  updatedAt: number
}
```

- **默认角色**：首次初始化时创建内置「丑鱼」（`builtIn: true`），soulMd = 用户当前全局 `soulMd`，档案 = 默认档案，model = legacy `model`。不可删除、不可改 builtIn；人设与模型可改。
- 角色存 JSON 主库而非 SQLite：量小、与会话同生命周期、避免引入第四个数据库。

### 会话绑定

- `ChatSession` 增加 `characterId?: string`，缺省视为默认角色。
- `STORE_VERSION` 3 → 4：迁移时为所有现有会话写入默认角色 id；同时创建默认角色记录。低于 3 的旧链照常先走既有归一化。

## 聊天链路

发送消息时按「会话 → characterId → 角色 → (providerProfile, model, soulMd)」解析；默认角色解析到 legacy 全局配置。需要逐一排查读取 `config.provider/baseUrl/apiKey/model` 的调用点：

- **聊天场景**（流式发送、标题生成、会话内工具）：按角色解析。
- **非聊天场景**（主动问候、模型诊断、记忆 embedding 等既有独立配置项）：维持现状用默认档案/各自配置，不掺角色。

解析失败（档案被删、模型为空、key 缺失）在发送前校验并报可操作错误（「角色 X 的供应商档案已删除，请到设置页处理」），**不静默回退**到全局配置。

## 通讯录页 UI（工作区新增「通讯录」页）

- `WorkspacePage` 增加 `'contacts'`，导航位次在「会话」「任务」之间，通讯录图标；`ChatPanel.tsx` 分发挂载，模式与 tasks 页一致。
- **列表**：角色卡片行（头像、名字、模型、档案名、最近会话时间）+ 搜索框（按名字/模型过滤）+「新建角色」按钮；默认角色带内置标记。
- **点击角色**：跳回会话页，定位该角色最近会话（无则新建空会话）；会话列表按当前角色过滤展示。
- **新建/编辑表单**：名字（必填、唯一）、emoji 头像、人设编辑器（复用设置页 soulMd 编辑交互）、档案下拉、模型名（必填）。
- **删除**：确认框明确列出「将同时删除该角色的 N 个会话」；确认后角色与其全部会话一并删除（人设错位的历史会话保留无意义）；默认角色不可删；档案被引用时阻止删除档案并列出引用角色。
- 键盘全程可操作（列表方向键、Enter 开聊、Esc 取消），空态/错误提示与 tasks 页现有模式一致；按迭代规则覆盖 375px 窄屏、暗色、焦点可见与减少动画。

## IPC

`electronAPI.characters.*`：`list / create / update / delete`；`electronAPI.providerProfiles.*`：`list / create / update / delete`（设置页档案管理用）。渲染层事件 `chouyu:characters-changed` 触发通讯录与导航刷新，模式同 `chouyu:tasks-changed`。

## 边界与非目标（YAGNI）

- 不做：多角色群聊、角色市场、桌宠形象切换、会话内换角色、跨角色会话迁移、头像图片上传、分组/置顶/未读计数、角色导入导出（以上除群聊外均列二期候选）。
- 角色不参与记忆隔离：长期记忆仍全局共享，不按角色分库。
- 不做角色的排序/权重字段，列表按最近会话时间排序即可。

## 测试与验收

- **单测**：legacy 档案合成（空列表、部分字段、claude/openai 分支）；`sanitizeConfigPatch` 档案列表校验；STORE_VERSION 4 会话迁移与默认角色创建；角色 CRUD 边界（默认角色不可删、名字唯一、必填校验、档案引用删除阻止）；聊天配置解析链（默认角色走 legacy、自定义角色走档案、解析失败报错文案）。
- **Electron 冒烟**：通讯录页导航可达；建角色 → 点击开聊 → 发送消息走角色配置；旧会话归入默认角色。
- **手动验收（用户）**：配置两个档案 → 建两个角色 → 通讯录点击切换聊天，人设与模型各自生效 → 重启后角色、会话归属与档案均在 → 删除角色连会话一并清除。
- **门禁**：`typecheck:node` / `typecheck:web`、vitest 全量、生产构建、Electron 冒烟；完成后更新 `docs/roadmap.md`（新批次条目）。
