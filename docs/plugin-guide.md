# ChouYu 插件开发指南

本文档面向开发者和 LLM，提供完整的插件接入规范。阅读本文档后，你可以独立实现一个新插件并接入 ChouYu 系统。

## 概述

ChouYu 插件系统采用**约定式静态注册**架构：

- 插件是一个 TypeScript 模块，实现 `PluginDefinition` 接口
- 插件运行在 Electron Main Process（可访问网络、文件系统）
- 框架自动处理：IPC 通道注册、命令菜单、设置面板 UI
- 插件开发者只需关注业务逻辑

## 快速开始：3 步创建插件

### 第 1 步：创建插件文件

```
src/main/plugins/
└── your-plugin/
    └── index.ts
```

### 第 2 步：实现接口

```typescript
import { PluginDefinition, ExecuteResult } from '../types'
import { getState, setState } from '../../database'

const PLUGIN_ID = 'your-plugin'

export const yourPlugin: PluginDefinition = {
  id: PLUGIN_ID,
  command: 'yp',                    // 用户输入 /yp 触发
  name: '你的插件',
  description: '一句话描述功能',

  async execute(content: string): Promise<ExecuteResult> {
    // 你的核心逻辑 - 成功时返回 message，失败时 throw Error
    return { message: '执行成功' }
  }
}
```

### 第 3 步：注册插件

在 `src/main/plugins/registry.ts` 中添加：

```typescript
import { yourPlugin } from './your-plugin'

const PLUGINS: PluginDefinition[] = [
  bbtalkPlugin,
  yourPlugin       // ← 加这一行
]
```

完成。框架会自动为你的插件注册 IPC 通道和命令菜单项。

---

## 接口定义

### PluginDefinition（完整接口）

```typescript
interface PluginDefinition {
  // ─── 必填字段 ───────────────────────────────────
  id: string              // 唯一标识，kebab-case，如 'my-translator'
  command: string         // 斜杠命令名（不含 /），如 'tr'
  name: string            // 显示名称，如 '翻译助手'
  description: string     // 命令菜单中的描述文字

  // ─── 必填方法 ───────────────────────────────────
  execute(content: string): Promise<ExecuteResult>

  // ─── 可选：认证 ─────────────────────────────────
  authMethods?: AuthMethod[]
  login?(credentials: Record<string, string>): Promise<LoginResult>
  logout?(): Promise<void>
  isAuthenticated?(): boolean

  // ─── 可选：生命周期 ─────────────────────────────
  init?(): Promise<void>

  // ─── 可选：UI 增强 ──────────────────────────────
  icon?: string              // emoji，显示在工具栏按钮上
  inputPlaceholder?: string  // 插件模式下输入框占位文字
  requiresContent?: boolean  // 是否必须有内容才能执行
}
```

### ExecuteResult

```typescript
/** 插件 execute() 返回此类型 - 无需 ok 字段 */
interface ExecuteResult {
  message: string           // 状态文本: "发布成功 ✓" / "翻译完成"
  detail?: string           // 原始/详细信息（可折叠展示）
  actions?: ResultAction[]  // 可选操作按钮
}
```

**约定：**
- 成功时直接返回 `{ message: '...' }`
- 失败时 `throw new Error('失败原因')`
- 框架自动捕获异常并包装为错误消息

### ResultAction

```typescript
interface ResultAction {
  label: string             // 按钮文本: "复制", "查看", "重试"
  action: 'copy' | 'open-url' | 'retry'
  payload?: string          // 复制内容 / 打开的 URL
}
```

### LoginResult

```typescript
/** login() 方法返回此类型 - 需要 ok 字段 */
interface LoginResult {
  ok: boolean
  message: string
}
```

`login()` 保留 `ok` 字段，因为设置面板需要明确知道登录成功/失败。

### PluginMessageData

```typescript
/** 框架包装后传递给 Renderer 的完整消息数据 */
interface PluginMessageData {
  pluginId: string
  pluginName: string
  pluginIcon?: string
  ok: boolean               // 框架判定：正常返回 = true，throw = false
  message: string
  inputContent: string      // 用户原始输入（框架填充）
  detail?: string
  actions?: ResultAction[]
}
```

### AuthMethod

```typescript
interface AuthMethod {
  id: string        // 'credentials' | 'token' | 'apikey' | custom
  label: string     // "账号密码" | "Token" | "API Key"
  fields: AuthField[]
}
```

### AuthField

```typescript
interface AuthField {
  key: string                        // 字段标识符
  label: string                      // 表单标签
  type: 'text' | 'password' | 'url'  // 输入框类型
  placeholder?: string               // 占位提示
  required?: boolean                 // 是否必填（默认 true）
  persistent?: boolean               // 登录后是否仍显示（默认 false）
}
```

---

## 数据持久化

插件通过 `getState` / `setState` 存储数据，框架自动添加命名空间前缀避免冲突：

```typescript
import { getState, setState } from '../../database'

const PLUGIN_ID = 'my-plugin'

// 读取
const token = getState(`plugin:${PLUGIN_ID}:api_key`)

// 写入
setState(`plugin:${PLUGIN_ID}:api_key`, 'sk-xxx')
```

存储位置：`%APPDATA%/chouyu/chouyu-data.json` 的 `state` 字段。

---

## 认证模式

使用 `authMethods` 数组声明支持的认证方式。设置面板会自动根据数组长度决定是否显示 Tab 切换。

### 模式 1：用户名密码（credentials）

适用于：有用户系统的服务（如 BBTalk）

```typescript
{
  authMethods: [
    {
      id: 'credentials',
      label: '账号密码',
      fields: [
        { key: 'username', label: '用户名', type: 'text', required: true },
        { key: 'password', label: '密码', type: 'password', required: true }
      ]
    }
  ],

  async login(credentials) {
    const method = credentials._authMethod // 'credentials'
    const { username, password } = credentials
    // 调用登录 API，存储 token
    return { ok: true, message: '登录成功' }
  },

  async logout() {
    // 清除 token
  },

  isAuthenticated() {
    return !!myToken
  }
}
```

设置面板显示"登录"按钮。

### 模式 2：API Key（apikey）

适用于：第三方 API 服务（如翻译 API、天气 API）

```typescript
{
  authMethods: [
    {
      id: 'apikey',
      label: 'API Key',
      fields: [
        { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-...' }
      ]
    }
  ],

  async login(credentials) {
    const { apiKey } = credentials
    setState(`plugin:${PLUGIN_ID}:api_key`, apiKey)
    return { ok: true, message: '已保存' }
  },

  isAuthenticated() {
    return !!getState(`plugin:${PLUGIN_ID}:api_key`)
  }
}
```

设置面板显示"保存"按钮。

### 模式 3：Token 粘贴（token）

适用于：用户已有 token，直接粘贴

```typescript
{
  authMethods: [
    {
      id: 'token',
      label: 'Token',
      fields: [
        { key: 'token', label: 'Access Token', type: 'password', required: true }
      ]
    }
  ],

  async login(credentials) {
    setState(`plugin:${PLUGIN_ID}:token`, credentials.token)
    return { ok: true, message: '已保存' }
  }
}
```

### 多种认证方式

一个插件可以同时支持多种认证方式，设置面板会自动显示 Tab 切换：

```typescript
{
  authMethods: [
    {
      id: 'credentials',
      label: '账号密码',
      fields: [
        { key: 'username', label: '用户名', type: 'text', required: true },
        { key: 'password', label: '密码', type: 'password', required: true }
      ]
    },
    {
      id: 'token',
      label: 'Token',
      fields: [
        { key: 'token', label: 'Refresh Token', type: 'password', required: true }
      ]
    }
  ],

  async login(credentials) {
    const method = credentials._authMethod
    if (method === 'token') {
      // Token 登录逻辑
    } else {
      // 账号密码登录逻辑
    }
    return { ok: true, message: '登录成功' }
  }
}
```

`credentials` 对象中会自动包含 `_authMethod` 字段，值为当前选中的认证方式 ID。

### 无认证

如果插件不需要认证，省略 `authMethods`、`login`、`logout`、`isAuthenticated` 即可。

---

## 工具栏按钮

声明 `icon` 字段后，插件会在输入框工具栏显示一个快捷按钮：

```typescript
{
  icon: '📝',                        // 工具栏按钮图标
  inputPlaceholder: '记点什么...',    // 点击后输入框占位文字
}
```

用户点击按钮 → 进入插件输入模式 → 输入内容 → 按 Enter 执行 → 自动退出模式。

规则：
- 最多显示 2 个插件按钮，多余的收入"⋯"菜单
- 按 Esc 或再次点击按钮退出插件模式

---

## 生命周期

```
应用启动
  │
  ├── pluginRegistry.initialize()
  │     ├── 检查命令冲突
  │     ├── 为每个插件创建存储上下文
  │     ├── 调用每个插件的 init()（失败不影响其他插件）
  │     └── 注册 IPC 通道
  │
  ▼
应用运行中
  │
  ├── 用户输入 /command → execute(content)
  │     ├── 成功：框架包装为 PluginMessageData { ok: true, ... }
  │     └── 抛异常：框架包装为 PluginMessageData { ok: false, ... }
  ├── 用户在设置中登录 → login(credentials)
  ├── 用户在设置中登出 → logout()
  │
  ▼
应用退出（无特殊处理，数据已实时持久化）
```

---

## 框架自动处理的事

你不需要关心以下内容，框架全部自动完成：

| 功能 | 框架行为 |
|------|----------|
| IPC 通道 | 自动注册 `plugin:{id}:execute`、`login`、`logout`、`is-authenticated` |
| 命令菜单 | 自动将 `/{command}` 加入 `/` 菜单 |
| 设置面板 | 根据 `authMethods` 自动生成登录表单（多方式时显示 Tab） |
| 工具栏按钮 | 根据 `icon` 自动渲染 |
| 认证前检查 | 有 `authMethods` 的插件，未登录时执行会自动提示 |
| 内容校验 | `requiresContent: true` 时空内容自动拦截 |
| 错误包装 | `execute()` 抛异常时自动包装为 `PluginMessageData { ok: false }` |
| 结果包装 | `execute()` 正常返回时包装为 `PluginMessageData { ok: true }` |
| 输入内容 | 框架自动将用户输入填充到 `PluginMessageData.inputContent` |

---

## 完整示例：翻译插件（无认证）

```typescript
import { PluginDefinition, ExecuteResult } from '../types'

export const translatorPlugin: PluginDefinition = {
  id: 'translator',
  command: 'tr',
  name: '翻译',
  description: '翻译文本（中↔英）',
  icon: '🌐',
  inputPlaceholder: '输入要翻译的文字...',
  requiresContent: true,

  async execute(content: string): Promise<ExecuteResult> {
    const res = await fetch('https://api.example.com/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: content, target: 'en' })
    })
    if (!res.ok) {
      throw new Error(`翻译失败：HTTP ${res.status}`)
    }
    const data = await res.json()
    return { message: data.translation }
  }
}
```

---

## 完整示例：BBTalk 插件（带认证）

参考 `src/main/plugins/bbtalk/index.ts`，这是一个完整的带 JWT 认证的插件实现，包含：

- 多种认证方式（账号密码 + Token）
- Access token 内存持有（不落盘）
- Refresh token 持久化存储
- 自动刷新（过期前 5 分钟）
- 401 时自动重试
- 启动时恢复登录态
- 失败时 throw Error（框架自动包装）

---

## 注意事项

1. **插件 ID 必须唯一**，使用 kebab-case 格式
2. **命令名不能重复**，否则应用启动时会报错
3. **init() 失败不会阻止应用启动**，但该插件可能无法正常工作
4. **敏感数据**（如 access token）建议只放内存，refresh token 可持久化
5. **网络请求**在 Main Process 中执行，无 CORS 限制
6. **execute() 成功时**返回 `{ message }` 即可，失败时 `throw new Error()`
7. **login() 仍需返回** `{ ok, message }` 格式（`LoginResult` 类型）
8. **credentials._authMethod** 标识用户选择的认证方式

---

## 目录结构约定

```
src/main/plugins/
├── types.ts              # 接口定义（不要修改）
├── registry.ts           # 注册表（只需加一行 import + 注册）
├── bbtalk/               # BBTalk 插件
│   └── index.ts
├── your-plugin/          # 你的插件
│   └── index.ts
└── another-plugin/       # 另一个插件
    └── index.ts
```

每个插件一个目录，目录名 = 插件 ID。
