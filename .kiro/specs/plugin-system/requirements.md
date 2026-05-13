# 需求文档：ChouYu 插件系统

## 简介

ChouYu 插件系统为桌面 AI 宠物助手提供标准化的第三方集成能力。通过约定式插件接口，外部系统（如 BBTalk 微博客、翻译器、TODO 应用等）可以注册为斜杠命令，在 ChouYu 聊天面板中被用户调用。插件运行在 Main Process，拥有网络访问和本地存储能力。框架自动处理命令注册、IPC 通道建立、设置面板生成等基础设施工作。

本文档同时作为**内部设计规范**和**外部集成指南**，确保任何开发者或 LLM 阅读后可独立实现新插件，无需额外提问。

## 术语表

- **Plugin（插件）**: 实现 `PluginDefinition` 接口的 TypeScript 模块，提供一个斜杠命令及其执行逻辑
- **Plugin_Registry（插件注册表）**: 集中管理所有已注册插件的模块，负责插件发现和生命周期管理
- **Plugin_Executor（插件执行器）**: Main Process 中接收 IPC 调用并路由到对应插件 `execute()` 方法的模块
- **Command_Router（命令路由器）**: Renderer Process 中识别用户输入的斜杠命令并分发到对应插件 IPC 通道的模块
- **Auth_Field（认证字段）**: 插件声明的登录表单字段描述，用于设置面板自动生成登录 UI
- **Plugin_State（插件状态）**: 以 `plugin:{pluginId}:{key}` 为键名存储在 `database.ts` state 中的插件持久化数据
- **Execute_Result（执行结果）**: 插件 `execute()` 方法返回的 `{ ok: boolean; message: string }` 结构
- **Settings_Tab（设置标签页）**: 设置面板中为每个需要认证的插件自动生成的配置页面

## 需求

### 需求 1：插件接口定义

**用户故事：** 作为插件开发者，我希望有一个清晰的 TypeScript 接口定义，以便我知道实现一个插件需要提供哪些字段和方法。

#### 验收标准

1. THE Plugin_Registry SHALL 要求每个插件提供唯一的 `id` 字符串标识符（kebab-case 格式）
2. THE Plugin_Registry SHALL 要求每个插件提供 `command` 字段，定义触发该插件的斜杠命令名称（不含 `/` 前缀）
3. THE Plugin_Registry SHALL 要求每个插件提供 `name` 字段作为人类可读的显示名称
4. THE Plugin_Registry SHALL 要求每个插件提供 `description` 字段，用于命令菜单中的提示文字
5. THE Plugin_Registry SHALL 要求每个插件提供 `execute(content: string): Promise<ExecuteResult>` 方法，接收命令后的文本内容并返回执行结果
6. THE Plugin_Registry SHALL 允许插件可选地提供 `authFields` 数组，声明登录所需的表单字段
7. THE Plugin_Registry SHALL 允许插件可选地提供 `login(credentials: Record<string, string>): Promise<ExecuteResult>` 方法处理认证
8. THE Plugin_Registry SHALL 允许插件可选地提供 `logout(): Promise<void>` 方法清除认证状态
9. THE Plugin_Registry SHALL 允许插件可选地提供 `isAuthenticated(): boolean` 方法返回当前认证状态
10. THE Plugin_Registry SHALL 允许插件可选地提供 `init(): Promise<void>` 方法，在应用启动时执行初始化逻辑（如恢复登录态）
11. THE Plugin_Registry SHALL 允许插件可选地提供 `icon: string` 字段（emoji 或 SVG path），用于工具栏快捷按钮
12. THE Plugin_Registry SHALL 允许插件可选地提供 `inputPlaceholder: string` 字段，定义插件输入模式下的占位提示文字
13. THE Plugin_Registry SHALL 允许插件可选地提供 `requiresContent: boolean` 字段，声明执行时是否必须有内容输入

### 需求 2：插件注册与发现

**用户故事：** 作为系统维护者，我希望有一个集中的注册表管理所有插件，以便框架能自动发现和加载插件。

#### 验收标准

1. THE Plugin_Registry SHALL 在应用启动时从静态导入列表中加载所有已注册插件
2. THE Plugin_Registry SHALL 对每个已注册插件调用其 `init()` 方法（如果存在）完成初始化
3. THE Plugin_Registry SHALL 提供 `getPlugins()` 方法返回所有已注册插件的列表
4. THE Plugin_Registry SHALL 提供 `getPlugin(id: string)` 方法按 ID 查找特定插件
5. IF 两个插件注册了相同的 `command` 值，THEN THE Plugin_Registry SHALL 在启动时抛出错误并记录冲突信息
6. IF 插件的 `init()` 方法抛出异常，THEN THE Plugin_Registry SHALL 记录错误日志但继续加载其他插件

### 需求 3：命令路由与执行

**用户故事：** 作为用户，我希望在聊天输入框中输入 `/命令 内容` 即可触发对应插件功能，并在聊天气泡中看到执行结果。

#### 验收标准

1. WHEN 用户输入以 `/` 开头的文本，THE Command_Router SHALL 将第一个空格前的部分作为命令名进行匹配
2. WHEN 命令名匹配到已注册插件的 `command` 字段，THE Command_Router SHALL 通过 IPC 通道将空格后的内容发送到 Main Process 的 Plugin_Executor
3. WHEN Plugin_Executor 收到执行请求，THE Plugin_Executor SHALL 调用对应插件的 `execute(content)` 方法
4. WHEN 插件 `execute()` 返回 `{ ok: true, message }` 时，THE Command_Router SHALL 将 `message` 作为 assistant 角色的聊天消息显示在消息区域
5. WHEN 插件 `execute()` 返回 `{ ok: false, message }` 时，THE Command_Router SHALL 将 `message` 作为错误提示显示在消息区域
6. IF 插件 `execute()` 抛出未捕获异常，THEN THE Plugin_Executor SHALL 返回 `{ ok: false, message: "插件执行出错：{错误信息}" }`
7. THE Command_Router SHALL 在命令菜单中显示所有已注册插件的命令，包含 `command` 和 `description`
8. WHEN 用户输入 `/` 时，THE Command_Router SHALL 在命令菜单中同时显示内置命令和插件命令

### 需求 4：IPC 通道自动注册

**用户故事：** 作为插件开发者，我不希望手动编写 IPC 通道代码，框架应自动为每个插件建立通信通道。

#### 验收标准

1. WHEN Plugin_Registry 加载插件时，THE Plugin_Registry SHALL 为每个插件自动注册 `plugin:{pluginId}:execute` IPC handle 通道
2. WHEN 插件声明了 `login` 方法，THE Plugin_Registry SHALL 自动注册 `plugin:{pluginId}:login` IPC handle 通道
3. WHEN 插件声明了 `logout` 方法，THE Plugin_Registry SHALL 自动注册 `plugin:{pluginId}:logout` IPC handle 通道
4. WHEN 插件声明了 `isAuthenticated` 方法，THE Plugin_Registry SHALL 自动注册 `plugin:{pluginId}:is-authenticated` IPC handle 通道
5. THE Plugin_Registry SHALL 在 preload bridge 中暴露统一的插件调用接口，使 Renderer 可通过 `window.electronAPI.plugin.execute(pluginId, content)` 调用插件

### 需求 5：插件数据持久化

**用户故事：** 作为插件开发者，我希望能持久化存储插件数据（如认证令牌），且不与其他插件或系统数据冲突。

#### 验收标准

1. THE Plugin_Executor SHALL 为插件提供 `getState(key: string): string | null` 方法，内部映射为 `database.getState('plugin:{pluginId}:{key}')`
2. THE Plugin_Executor SHALL 为插件提供 `setState(key: string, value: string): void` 方法，内部映射为 `database.setState('plugin:{pluginId}:{key}', value)`
3. THE Plugin_Executor SHALL 确保每个插件只能访问自己命名空间下的状态数据
4. WHEN 插件调用 `setState` 时，THE Plugin_Executor SHALL 立即将数据持久化到 JSON 文件

### 需求 6：设置面板自动生成

**用户故事：** 作为用户，我希望在设置面板中看到插件的登录配置界面，无需插件开发者编写 UI 代码。

#### 验收标准

1. WHEN 插件声明了 `authFields` 数组，THE Settings_Tab SHALL 在设置面板导航中为该插件添加一个标签页
2. THE Settings_Tab SHALL 根据 `authFields` 中每个字段的 `type`（text/password）、`label`、`placeholder` 自动渲染表单输入框
3. WHEN 用户填写表单并点击登录按钮，THE Settings_Tab SHALL 收集所有字段值并通过 IPC 调用插件的 `login` 方法
4. WHEN 插件 `login()` 返回 `{ ok: true }` 时，THE Settings_Tab SHALL 显示登录成功状态并展示登出按钮
5. WHEN 插件 `login()` 返回 `{ ok: false, message }` 时，THE Settings_Tab SHALL 显示错误信息
6. WHEN 用户点击登出按钮，THE Settings_Tab SHALL 通过 IPC 调用插件的 `logout` 方法并恢复为登录表单状态
7. WHEN 设置面板打开时，THE Settings_Tab SHALL 通过 IPC 调用插件的 `isAuthenticated` 方法确定当前显示状态（登录表单或已登录状态）
8. THE Settings_Tab SHALL 允许 `authFields` 声明 `required: boolean` 属性，对必填字段在提交前进行非空校验

### 需求 7：认证字段声明格式

**用户故事：** 作为插件开发者，我希望通过简单的声明式配置定义登录表单，支持多种认证方式（用户名密码、API Key、OAuth token 等），无需了解 UI 实现细节。

#### 验收标准

1. THE Plugin_Registry SHALL 要求每个 authField 包含 `key: string` 作为字段标识符
2. THE Plugin_Registry SHALL 要求每个 authField 包含 `label: string` 作为表单标签文字
3. THE Plugin_Registry SHALL 要求每个 authField 包含 `type: 'text' | 'password' | 'url'` 指定输入框类型
4. THE Plugin_Registry SHALL 允许每个 authField 可选地包含 `placeholder: string` 作为输入框占位提示
5. THE Plugin_Registry SHALL 允许每个 authField 可选地包含 `required: boolean` 标记是否必填（默认为 true）
6. THE Plugin_Registry SHALL 允许插件声明 `authType: 'credentials' | 'apikey' | 'token'` 字段，标识认证方式类型（默认为 'credentials'）
7. WHEN `authType` 为 `'apikey'` 时，THE Settings_Tab SHALL 显示"保存"按钮而非"登录"按钮，且提交后直接调用 `login({ apiKey: value })` 而不需要用户名密码
8. WHEN `authType` 为 `'token'` 时，THE Settings_Tab SHALL 显示"保存"按钮，提交后调用 `login({ token: value })`
9. WHEN `authType` 为 `'credentials'` 时，THE Settings_Tab SHALL 显示"登录"按钮，提交后调用 `login({ username, password, ... })`
10. THE Plugin_Registry SHALL 允许 authField 声明 `persistent: boolean`（默认 false），标记该字段值是否在登录成功后仍显示在设置面板中（如 API 地址需要持久显示，密码不需要）

### 需求 8：插件命令参数校验

**用户故事：** 作为用户，我希望在命令缺少必要参数时得到友好提示，而不是看到执行错误。

#### 验收标准

1. WHEN 用户输入的命令后没有内容（如仅输入 `/bb`），且插件声明 `requiresContent: true`，THE Command_Router SHALL 显示提示消息 "请输入内容：/{command} {description中的用法提示}"
2. WHEN 插件未声明 `requiresContent` 或声明为 `false`，THE Command_Router SHALL 允许空内容调用插件的 `execute("")`

### 需求 12：工具栏插件快捷入口

**用户故事：** 作为用户，我希望在输入框工具栏上看到插件图标按钮，点击后直接进入该插件的输入模式，无需记忆斜杠命令。

#### 验收标准

1. THE Plugin_Registry SHALL 允许插件可选地提供 `icon: string` 字段（emoji 或 SVG path），用于工具栏按钮显示
2. THE Plugin_Registry SHALL 允许插件可选地提供 `inputPlaceholder: string` 字段，定义插件模式下输入框的占位提示文字
3. WHEN 插件声明了 `icon` 字段，THE InputArea SHALL 在工具栏左侧（截图/附件按钮旁）显示该插件的图标按钮
4. WHEN 用户点击插件图标按钮，THE InputArea SHALL 进入"插件输入模式"：
   - 输入框 placeholder 切换为插件的 `inputPlaceholder`（默认为 "输入内容..."）
   - 发送按钮样式变为插件主题色或文字（如"发布"）
   - 工具栏显示当前激活的插件名称标识
5. WHEN 处于插件输入模式时用户按 Enter 发送，THE InputArea SHALL 将内容通过插件的 `execute()` 方法执行（而非发送给 AI）
6. WHEN 处于插件输入模式时用户按 Esc 或再次点击插件图标，THE InputArea SHALL 退出插件模式，恢复为正常 AI 聊天模式
7. WHEN 已注册的带 `icon` 的插件超过 2 个，THE InputArea SHALL 将溢出的插件收入"更多"菜单按钮（⋯），点击后弹出插件列表供选择
8. THE InputArea SHALL 同时保留斜杠命令方式（`/命令 内容`），两种触发方式等价

### 需求 9：插件认证状态与执行前检查

**用户故事：** 作为用户，我希望在未登录时使用需要认证的插件命令能得到明确提示，引导我去设置中登录。

#### 验收标准

1. WHEN 插件声明了 `authFields` 且 `isAuthenticated()` 返回 `false`，且用户尝试执行该插件命令，THE Plugin_Executor SHALL 返回 `{ ok: false, message: "请先在设置中登录 {plugin.name}" }`
2. WHEN 插件未声明 `authFields`，THE Plugin_Executor SHALL 直接执行 `execute()` 而不进行认证检查

### 需求 10：Preload Bridge 插件 API 扩展

**用户故事：** 作为框架维护者，我希望 preload bridge 提供类型安全的插件调用接口，使 Renderer 进程能安全地与插件通信。

#### 验收标准

1. THE Preload_Bridge SHALL 在 `window.electronAPI` 下暴露 `plugin` 命名空间
2. THE Preload_Bridge SHALL 提供 `plugin.execute(pluginId: string, content: string): Promise<ExecuteResult>` 方法
3. THE Preload_Bridge SHALL 提供 `plugin.login(pluginId: string, credentials: Record<string, string>): Promise<ExecuteResult>` 方法
4. THE Preload_Bridge SHALL 提供 `plugin.logout(pluginId: string): Promise<void>` 方法
5. THE Preload_Bridge SHALL 提供 `plugin.isAuthenticated(pluginId: string): Promise<boolean>` 方法
6. THE Preload_Bridge SHALL 提供 `plugin.getPlugins(): Promise<PluginInfo[]>` 方法，返回所有插件的元数据（id, command, name, description, hasAuth）

### 需求 11：BBTalk 参考插件实现

**用户故事：** 作为插件开发者，我希望有一个完整的参考实现（BBTalk 插件），展示如何实现带认证的插件。

#### 验收标准

1. THE BBTalk_Plugin SHALL 注册命令 `bb`，描述为 "发布内容到 BBTalk"
2. THE BBTalk_Plugin SHALL 声明 `icon` 为 "📝"，`inputPlaceholder` 为 "记点什么..."
3. THE BBTalk_Plugin SHALL 声明 `requiresContent: true`
4. THE BBTalk_Plugin SHALL 声明 `authFields` 包含 apiUrl（文本，可选，placeholder 为默认 API 地址）、username（文本）、password（密码）三个字段
5. WHEN 用户通过设置面板登录时，THE BBTalk_Plugin SHALL 向 BBTalk API 发送 JWT 认证请求并存储 refresh token
6. WHEN 用户执行 `/bb 内容` 或在插件模式下发送内容时，THE BBTalk_Plugin SHALL 使用存储的认证令牌向 BBTalk API 发布内容
7. WHEN access token 过期时，THE BBTalk_Plugin SHALL 自动使用 refresh token 刷新认证
8. WHEN 应用启动时，THE BBTalk_Plugin SHALL 在 `init()` 中尝试使用存储的 refresh token 恢复登录态
9. WHEN 发布成功时，THE BBTalk_Plugin SHALL 返回 `{ ok: true, message: "发布成功 ✓" }`
10. IF 网络请求失败，THEN THE BBTalk_Plugin SHALL 返回 `{ ok: false, message: "发布失败：{具体错误}" }`
