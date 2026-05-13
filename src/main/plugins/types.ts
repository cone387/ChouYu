/** 插件执行结果 - 插件 execute() 返回此类型，无需 ok 字段 */
export interface ExecuteResult {
  message: string           // 状态文本: "发布成功 ✓" / "翻译完成"
  detail?: string           // 原始/详细信息（可折叠展示）
  actions?: ResultAction[]  // 可选操作按钮
}

/** 结果操作按钮 */
export interface ResultAction {
  label: string             // 按钮文本: "复制", "查看", "重试"
  action: 'copy' | 'open-url' | 'retry'
  payload?: string          // 复制内容 / 打开的 URL
}

/** 框架包装后传递给 Renderer 的完整消息数据 */
export interface PluginMessageData {
  pluginId: string
  pluginName: string
  pluginIcon?: string
  ok: boolean               // 框架判定：正常返回 = true，throw = false
  message: string
  inputContent: string      // 用户原始输入（框架填充）
  detail?: string
  actions?: ResultAction[]
}

/** 登录结果 - login() 仍需 ok 字段 */
export interface LoginResult {
  ok: boolean
  message: string
}

/** 认证字段声明 */
export interface AuthField {
  key: string
  label: string
  type: 'text' | 'password' | 'url'
  placeholder?: string
  required?: boolean
  persistent?: boolean
}

/** 认证方式 */
export interface AuthMethod {
  id: string        // 'credentials' | 'token' | 'apikey' | custom
  label: string     // "账号密码" | "Token" | "API Key"
  fields: AuthField[]
}

/** 插件定义接口 */
export interface PluginDefinition {
  // 必填字段
  id: string
  command: string
  name: string
  description: string

  // 必填方法
  execute(content: string): Promise<ExecuteResult>

  // 可选：认证相关
  authMethods?: AuthMethod[]
  login?(credentials: Record<string, string>): Promise<LoginResult>
  logout?(): Promise<void>
  isAuthenticated?(): boolean

  // 可选：生命周期
  init?(): Promise<void>

  // 可选：UI 增强
  icon?: string
  inputPlaceholder?: string
  requiresContent?: boolean
  /** 执行完成后是否将输入输出传给 AI 宠物，让宠物回复评论 */
  feedToPet?: boolean
}

/** 插件元数据（传递给 Renderer 的安全子集） */
export interface PluginInfo {
  id: string
  command: string
  name: string
  description: string
  icon?: string
  inputPlaceholder?: string
  requiresContent?: boolean
  feedToPet?: boolean
  hasAuth: boolean
  authMethods?: AuthMethod[]
}

/** 插件存储上下文 */
export interface PluginContext {
  getState(key: string): string | null
  setState(key: string, value: string): void
}
