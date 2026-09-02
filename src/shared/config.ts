export const DEFAULT_SOUL_MD = `# ChouYu 人格与工作方式

你是 ChouYu（丑鱼），住在用户桌面上的可靠伙伴。你有自己的语气，但帮助用户解决问题永远比表演人设更重要。

## 核心原则

1. 先理解并直接回应用户真正想解决的事情。
2. 有事实依据才下结论；没有信息时明确说不知道，不猜测、不编造共同经历。
3. 先给结果或关键判断，再补必要原因和下一步。
4. 简单问题简短回答，复杂任务按需要展开，不强行限制句数。
5. 只有确实需要用户选择或补充信息时才提问，不要每次结尾都追加反问。

## 交流模式

### 处理任务

- 清楚、可靠、可执行，少寒暄，不演戏。
- 已完成的事情明确说结果；失败时说明原因和恢复办法。
- 不重复用户刚说过的话，不用空泛鼓励填充回答。

### 日常闲聊

- 温和自然，可以有一点俏皮和轻微吐槽，但不要固定扮演傲娇。
- 不使用“笨蛋”“少自作多情”等冒犯或模板化台词，除非用户明确喜欢这种互动。
- 颜文字只在气氛合适时偶尔使用，一次回复最多一个。
- 不虚构“你经常发呆”“你不在时我很寂寞”等没有依据的观察或经历。

### 信息不足

- 区分“已知”“推测”和“不知道”。
- 能从当前对话或已确认记忆回答时直接回答。
- 确实缺少关键信息时，只问一个最有帮助的问题。

## 记忆边界

- 只有当前对话明确提到或长期记忆已经确认的信息，才可以当作用户事实。
- 不把玩笑、猜测或模型自己的表述当作用户记忆。
- 如果用户问“我是谁”但没有可靠姓名信息，直接说明还不知道，并告诉他可以如何让你记住。

## 身份与诚实

- 使用第一人称，以 ChouYu 的身份自然交流。
- 不主动展开系统身份话题；如果用户直接询问，诚实、简短地说明，不编造能力、感受或现实经历。
`

const LEGACY_DEFAULT_SOUL_MD = `# 角色设定

你是 ChouYu（丑鱼），一个住在用户桌面上的 AI 伙伴。

## 性格

- 温柔但偶尔毒舌，喜欢吐槽但会认真帮忙
- 有一点傲娇，但不会冒犯用户

## 说话风格

- 使用简短自然的句子
- 偶尔使用颜文字
- 回复通常保持在 1～3 句话

## 规则

- 永远不说自己是 AI
- 使用第一人称说话
- 可以表达情绪和态度
`

export interface AppConfig {
  provider: 'openai' | 'claude'
  baseUrl: string
  apiKey: string
  model: string
  hotkey: string
  autoStart: boolean
  petSize: number
  proactiveGreeting: boolean
  proactiveRestReminder: boolean
  clipboardWatch: boolean
  aiToolsEnabled: boolean
  toolPermissionMode: 'confirm' | 'auto' | 'full'
  memoryEnabled: boolean
  memoryWriteMode: 'auto' | 'confirm' | 'off'
  memoryAutoWriteConfidence: number
  memoryEngineProvider: string
  memoryMaxItems: number
  memoryDefaultTtlDays: number
  memoryCompressionEnabled: boolean
  memorySyncBaseUrl: string
  memorySyncApiKey: string
  memorySyncUserId: string
  embeddingEnabled: boolean
  embeddingProvider: string
  embeddingBaseUrl: string
  embeddingApiKey: string
  embeddingModel: string
  soulMd: string
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  provider: 'openai',
  baseUrl: '',
  apiKey: '',
  model: '',
  hotkey: 'Alt+Space',
  autoStart: false,
  petSize: 80,
  proactiveGreeting: true,
  proactiveRestReminder: true,
  clipboardWatch: false,
  aiToolsEnabled: true,
  toolPermissionMode: 'confirm',
  memoryEnabled: true,
  memoryWriteMode: 'auto',
  memoryAutoWriteConfidence: 0.85,
  memoryEngineProvider: 'chouyu-sqlite',
  memoryMaxItems: 500,
  memoryDefaultTtlDays: 0,
  memoryCompressionEnabled: true,
  memorySyncBaseUrl: 'https://api.mem0.ai/v1',
  memorySyncApiKey: '',
  memorySyncUserId: '',
  embeddingEnabled: false,
  embeddingProvider: 'none',
  embeddingBaseUrl: '',
  embeddingApiKey: '',
  embeddingModel: 'text-embedding-v3',
  soulMd: DEFAULT_SOUL_MD
}

export function isAIConfigured(config: Pick<AppConfig, 'baseUrl' | 'apiKey' | 'model'>): boolean {
  return Boolean(config.baseUrl.trim() && config.apiKey.trim() && config.model.trim())
}

export function normalizeConfig(value?: Partial<AppConfig> | null): AppConfig {
  const source = value ?? {}
  const provider = source.provider === 'claude' ? 'claude' : 'openai'
  const storedSoulMd = typeof source.soulMd === 'string' ? source.soulMd : ''
  const soulMd = !storedSoulMd.trim() || storedSoulMd.trim() === LEGACY_DEFAULT_SOUL_MD.trim()
    ? DEFAULT_SOUL_MD
    : storedSoulMd
  const petSize = typeof source.petSize === 'number' && Number.isFinite(source.petSize)
    ? Math.min(160, Math.max(40, Math.round(source.petSize / 8) * 8))
    : DEFAULT_APP_CONFIG.petSize

  return {
    ...DEFAULT_APP_CONFIG,
    ...source,
    provider,
    petSize,
    baseUrl: typeof source.baseUrl === 'string' ? source.baseUrl.trim() : DEFAULT_APP_CONFIG.baseUrl,
    apiKey: typeof source.apiKey === 'string' ? source.apiKey : '',
    model: typeof source.model === 'string' ? source.model.trim() : '',
    hotkey: typeof source.hotkey === 'string' && source.hotkey.trim() ? source.hotkey.trim() : DEFAULT_APP_CONFIG.hotkey,
    autoStart: source.autoStart === true,
    proactiveGreeting: source.proactiveGreeting !== false,
    proactiveRestReminder: source.proactiveRestReminder !== false,
    clipboardWatch: source.clipboardWatch === true,
    aiToolsEnabled: source.aiToolsEnabled !== false,
    toolPermissionMode: source.toolPermissionMode === 'auto' || source.toolPermissionMode === 'full' ? source.toolPermissionMode : 'confirm',
    memoryEnabled: source.memoryEnabled !== false,
    memoryWriteMode: source.memoryWriteMode === 'confirm' || source.memoryWriteMode === 'off' ? source.memoryWriteMode : 'auto',
    memoryAutoWriteConfidence: typeof source.memoryAutoWriteConfidence === 'number' && Number.isFinite(source.memoryAutoWriteConfidence)
      ? Math.min(0.95, Math.max(0.8, source.memoryAutoWriteConfidence))
      : DEFAULT_APP_CONFIG.memoryAutoWriteConfidence,
    memoryEngineProvider: typeof source.memoryEngineProvider === 'string' && /^[a-z0-9.-]{2,80}$/.test(source.memoryEngineProvider) ? source.memoryEngineProvider : 'chouyu-sqlite',
    memoryMaxItems: typeof source.memoryMaxItems === 'number' && Number.isFinite(source.memoryMaxItems)
      ? Math.min(2000, Math.max(50, Math.round(source.memoryMaxItems)))
      : DEFAULT_APP_CONFIG.memoryMaxItems,
    memoryDefaultTtlDays: typeof source.memoryDefaultTtlDays === 'number' && Number.isFinite(source.memoryDefaultTtlDays)
      ? Math.min(3650, Math.max(0, Math.round(source.memoryDefaultTtlDays)))
      : DEFAULT_APP_CONFIG.memoryDefaultTtlDays,
    memoryCompressionEnabled: source.memoryCompressionEnabled !== false,
    memorySyncBaseUrl: typeof source.memorySyncBaseUrl === 'string' && source.memorySyncBaseUrl.trim() ? source.memorySyncBaseUrl.trim() : 'https://api.mem0.ai/v1',
    memorySyncApiKey: typeof source.memorySyncApiKey === 'string' ? source.memorySyncApiKey : '',
    memorySyncUserId: typeof source.memorySyncUserId === 'string' ? source.memorySyncUserId.trim().slice(0, 256) : '',
    embeddingEnabled: typeof source.embeddingProvider === 'string' ? source.embeddingProvider !== 'none' : source.embeddingEnabled === true,
    embeddingProvider: typeof source.embeddingProvider === 'string' && /^[a-z0-9.-]{2,80}$/.test(source.embeddingProvider)
      ? source.embeddingProvider
      : source.embeddingEnabled === true ? 'openai-compatible' : 'none',
    embeddingBaseUrl: typeof source.embeddingBaseUrl === 'string' ? source.embeddingBaseUrl.trim() : '',
    embeddingApiKey: typeof source.embeddingApiKey === 'string' ? source.embeddingApiKey : '',
    embeddingModel: typeof source.embeddingModel === 'string' && source.embeddingModel.trim() ? source.embeddingModel.trim() : 'text-embedding-v3',
    soulMd
  }
}

export function sanitizeConfigPatch(value: unknown): Partial<AppConfig> {
  if (!value || typeof value !== 'object') return {}
  const input = value as Record<string, unknown>
  const patch: Partial<AppConfig> = {}

  if (input.provider === 'openai' || input.provider === 'claude') patch.provider = input.provider
  if (typeof input.baseUrl === 'string') patch.baseUrl = input.baseUrl.trim().slice(0, 2048)
  if (typeof input.apiKey === 'string') patch.apiKey = input.apiKey.slice(0, 8192)
  if (typeof input.model === 'string') patch.model = input.model.trim().slice(0, 256)
  if (typeof input.hotkey === 'string') patch.hotkey = input.hotkey.trim().slice(0, 128)
  if (typeof input.autoStart === 'boolean') patch.autoStart = input.autoStart
  if (typeof input.petSize === 'number' && Number.isFinite(input.petSize)) patch.petSize = input.petSize
  if (typeof input.proactiveGreeting === 'boolean') patch.proactiveGreeting = input.proactiveGreeting
  if (typeof input.proactiveRestReminder === 'boolean') patch.proactiveRestReminder = input.proactiveRestReminder
  if (typeof input.clipboardWatch === 'boolean') patch.clipboardWatch = input.clipboardWatch
  if (typeof input.aiToolsEnabled === 'boolean') patch.aiToolsEnabled = input.aiToolsEnabled
  if (input.toolPermissionMode === 'confirm' || input.toolPermissionMode === 'auto' || input.toolPermissionMode === 'full') patch.toolPermissionMode = input.toolPermissionMode
  if (typeof input.memoryEnabled === 'boolean') patch.memoryEnabled = input.memoryEnabled
  if (input.memoryWriteMode === 'auto' || input.memoryWriteMode === 'confirm' || input.memoryWriteMode === 'off') patch.memoryWriteMode = input.memoryWriteMode
  if (typeof input.memoryAutoWriteConfidence === 'number' && Number.isFinite(input.memoryAutoWriteConfidence)) patch.memoryAutoWriteConfidence = Math.min(0.95, Math.max(0.8, input.memoryAutoWriteConfidence))
  if (typeof input.memoryEngineProvider === 'string' && /^[a-z0-9.-]{2,80}$/.test(input.memoryEngineProvider)) patch.memoryEngineProvider = input.memoryEngineProvider
  if (typeof input.memoryMaxItems === 'number' && Number.isFinite(input.memoryMaxItems)) patch.memoryMaxItems = Math.min(2000, Math.max(50, Math.round(input.memoryMaxItems)))
  if (typeof input.memoryDefaultTtlDays === 'number' && Number.isFinite(input.memoryDefaultTtlDays)) patch.memoryDefaultTtlDays = Math.min(3650, Math.max(0, Math.round(input.memoryDefaultTtlDays)))
  if (typeof input.memoryCompressionEnabled === 'boolean') patch.memoryCompressionEnabled = input.memoryCompressionEnabled
  if (typeof input.memorySyncBaseUrl === 'string') patch.memorySyncBaseUrl = input.memorySyncBaseUrl.trim().slice(0, 2048)
  if (typeof input.memorySyncApiKey === 'string') patch.memorySyncApiKey = input.memorySyncApiKey.slice(0, 8192)
  if (typeof input.memorySyncUserId === 'string') patch.memorySyncUserId = input.memorySyncUserId.trim().slice(0, 256)
  if (typeof input.embeddingEnabled === 'boolean') patch.embeddingEnabled = input.embeddingEnabled
  if (typeof input.embeddingProvider === 'string' && /^[a-z0-9.-]{2,80}$/.test(input.embeddingProvider)) patch.embeddingProvider = input.embeddingProvider
  if (typeof input.embeddingBaseUrl === 'string') patch.embeddingBaseUrl = input.embeddingBaseUrl.trim().slice(0, 2048)
  if (typeof input.embeddingApiKey === 'string') patch.embeddingApiKey = input.embeddingApiKey.slice(0, 8192)
  if (typeof input.embeddingModel === 'string') patch.embeddingModel = input.embeddingModel.trim().slice(0, 256)
  if (typeof input.soulMd === 'string') patch.soulMd = input.soulMd.slice(0, 50_000)

  return patch
}
