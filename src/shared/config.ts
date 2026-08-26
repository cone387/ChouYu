export const DEFAULT_SOUL_MD = `# 角色设定

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
  soulMd: string
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  provider: 'openai',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: '',
  model: 'qwen-plus',
  hotkey: 'Alt+Space',
  autoStart: false,
  petSize: 80,
  proactiveGreeting: true,
  proactiveRestReminder: true,
  clipboardWatch: false,
  soulMd: DEFAULT_SOUL_MD
}

export function normalizeConfig(value?: Partial<AppConfig> | null): AppConfig {
  const source = value ?? {}
  const provider = source.provider === 'claude' ? 'claude' : 'openai'
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
    model: typeof source.model === 'string' && source.model.trim() ? source.model.trim() : DEFAULT_APP_CONFIG.model,
    hotkey: typeof source.hotkey === 'string' && source.hotkey.trim() ? source.hotkey.trim() : DEFAULT_APP_CONFIG.hotkey,
    autoStart: source.autoStart === true,
    proactiveGreeting: source.proactiveGreeting !== false,
    proactiveRestReminder: source.proactiveRestReminder !== false,
    clipboardWatch: source.clipboardWatch === true,
    soulMd: typeof source.soulMd === 'string' && source.soulMd.trim() ? source.soulMd : DEFAULT_SOUL_MD
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
  if (typeof input.soulMd === 'string') patch.soulMd = input.soulMd.slice(0, 50_000)

  return patch
}
