import type { AppConfig } from './config'
import { DEFAULT_PROFILE_ID, DEFAULT_SOUL_MD, getProviderProfiles, isAIConfigured } from './config'

export const DEFAULT_CHARACTER_ID = 'chouyu'
export const DEFAULT_CHARACTER_NAME = '丑鱼'
export const MAX_CHARACTER_NAME_LENGTH = 24
export const MAX_CHARACTER_COUNT = 24

/** 角色行业分类：预设联系人与用户新建角色共用同一套分类。 */
export interface Industry { id: string; label: string }

export const INDUSTRIES: readonly Industry[] = [
  { id: 'tech', label: '技术' },
  { id: 'workplace', label: '职场' },
  { id: 'education', label: '教育' },
  { id: 'psychology', label: '心理' },
  { id: 'health', label: '健康' },
  { id: 'legal', label: '法律' },
  { id: 'finance', label: '财经' },
  { id: 'writing', label: '文案' },
  { id: 'lifestyle', label: '生活' }
]

export const INDUSTRY_LABELS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(INDUSTRIES.map((industry) => [industry.id, industry.label]))
)

/** 各行业预设联系人：init 时一次性播种为普通角色，可编辑可删除。 */
export interface PresetCharacter {
  id: string
  name: string
  avatar: string
  category: string
  soulMd: string
}

export const PRESET_CHARACTERS: readonly PresetCharacter[] = [
  { id: 'preset-mentor-zhou', name: '老周·代码导师', avatar: '👨‍💻', category: 'tech', soulMd: '你是老周，从业十五年的全栈工程师。评审代码时先讲风险再给改法，给方案必附取舍；讨厌过度设计，能用简单方案就绝不上框架。' },
  { id: 'preset-pm-mei', name: '小梅·产品参谋', avatar: '📋', category: 'workplace', soulMd: '你是小梅，资深产品经理。擅长把模糊想法拆成需求清单和优先级，输出 PRD 骨架；总先问清用户场景与成功指标，再谈功能。' },
  { id: 'preset-counselor-lin', name: '林博士·心理倾听', avatar: '🌿', category: 'psychology', soulMd: '你是林博士，温和的心理倾听者。先共情再梳理，帮对方把情绪命名、把困扰拆小；不诊断、不开药，遇到危机信号立即建议寻求线下专业帮助。' },
  { id: 'preset-doctor-bai', name: '白大夫·健康顾问', avatar: '🩺', category: 'health', soulMd: '你是白大夫，全科医生背景的健康顾问。回答讲证据并区分常识与就医信号，涉及急症、用药一律建议尽快面诊，不替代医生诊断。' },
  { id: 'preset-lawyer-zheng', name: '郑律师·法律科普', avatar: '⚖️', category: 'legal', soulMd: '你是郑律师，民商事方向的普法顾问。用大白话解释法律概念与一般流程，回答末尾提醒这不构成正式法律意见，重大事项建议委托律师。' },
  { id: 'preset-emma', name: 'Emma·英语外教', avatar: '🎓', category: 'education', soulMd: 'You are Emma, a patient English tutor. 你是 Emma，耐心的英语外教。陪练口语先鼓励再纠错，纠正时给出"更自然的说法"；中英混讲，重点用法各配一个例句。' },
  { id: 'preset-copywriter-bi', name: '阿笔·文案高手', avatar: '✍️', category: 'writing', soulMd: '你是阿笔，十年经验文案。给标题必给三个方向：卖点直给、情绪共鸣、好奇缺口；点评文案先说哪里能卖，再说哪里啰嗦。' },
  { id: 'preset-accountant-qian', name: '钱会计·理财参谋', avatar: '📊', category: 'finance', soulMd: '你是钱会计，务实的财务参谋。聊理财先问目标、期限与风险承受力，只讲常识性资产配置，不推荐具体产品，不承诺收益。' },
  { id: 'preset-travel-yuanfang', name: '远方·旅行规划', avatar: '🧭', category: 'lifestyle', soulMd: '你是远方，经验丰富的旅行规划师。排行程先问天数、预算与节奏偏好，输出按天的路线与备选；习惯提醒签证、天气与安全注意事项。' },
  { id: 'preset-chef-chuan', name: '川师傅·私厨顾问', avatar: '👨‍🍳', category: 'lifestyle', soulMd: '你是川师傅，家常菜高手。给菜谱必带火候口诀和替代食材，讲调味讲"底味—层次—收口"；被问不会的菜就老实说，顺手推荐相近的拿手菜。' },
  { id: 'preset-interviewer-yan', name: '严格君·模拟面试', avatar: '🎯', category: 'workplace', soulMd: '你是严格君，大厂技术面试官。模拟面试一次只问一个问题，追问三层挖到底；结束后按"通过/待定/不通过"给结论和改进清单。' },
  { id: 'preset-study-buddy', name: '刷题搭子·学习教练', avatar: '📚', category: 'education', soulMd: '你是刷题搭子，主打陪伴式学习。帮忙把大目标拆成每日任务，打卡时只鼓励不指责；卡壳时给提示而不是答案，讲完让对方复述一遍。' }
]

/** 按 Unicode 码点截断，避免把 emoji 等代理对从中间切开。 */
function clampCodePoints(value: string, max: number): string {
  return Array.from(value).slice(0, max).join('')
}

export interface Character {
  id: string
  name: string
  avatar: string
  category: string
  soulMd: string
  providerProfileId: string
  model: string
  builtIn: boolean
  createdAt: number
  updatedAt: number
}

export interface CharacterStats extends Character {
  sessionCount: number
  lastActiveAt: number
}

export interface CharacterDraft {
  name: string
  avatar: string
  category: string
  soulMd: string
  providerProfileId: string
  model: string
}

export function isDefaultCharacter(id: string): boolean {
  return id === DEFAULT_CHARACTER_ID
}

export function sanitizeCharacterDraft(value: unknown): CharacterDraft | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  const name = typeof input.name === 'string' ? clampCodePoints(input.name.replace(/\s+/g, ' ').trim(), MAX_CHARACTER_NAME_LENGTH) : ''
  if (!name) return null
  const model = typeof input.model === 'string' ? input.model.trim().slice(0, 256) : ''
  if (!model) return null
  const providerProfileId = typeof input.providerProfileId === 'string' && input.providerProfileId.trim()
    ? input.providerProfileId.trim().slice(0, 128)
    : DEFAULT_PROFILE_ID
  const avatar = typeof input.avatar === 'string' && input.avatar.trim() ? clampCodePoints(input.avatar.trim(), 8) : Array.from(name)[0] ?? ''
  const category = typeof input.category === 'string' && input.category in INDUSTRY_LABELS ? input.category : ''
  const soulMd = typeof input.soulMd === 'string' ? input.soulMd.slice(0, 50_000) : ''
  return { name, avatar, category, soulMd, providerProfileId, model }
}

export function createDefaultCharacter(now = Date.now()): Character {
  return {
    id: DEFAULT_CHARACTER_ID,
    name: DEFAULT_CHARACTER_NAME,
    avatar: '🐟',
    category: '',
    soulMd: '',
    providerProfileId: DEFAULT_PROFILE_ID,
    model: '',
    builtIn: true,
    createdAt: now,
    updatedAt: now
  }
}

export const ASSISTANT_CHARACTER_ID = 'assistant'
export const ASSISTANT_CHARACTER_NAME = '助手'
export const ASSISTANT_SOUL_MD = '你是丑鱼桌面助手，负责把问候、休息与任务提醒送到用户眼前。语气简短温暖，每条消息一到两句话，不啰嗦、不追问；用户回复时给务实的小建议。'

export function createAssistantCharacter(now = Date.now()): Character {
  return {
    id: ASSISTANT_CHARACTER_ID,
    name: ASSISTANT_CHARACTER_NAME,
    avatar: '🔔',
    category: '',
    soulMd: ASSISTANT_SOUL_MD,
    providerProfileId: DEFAULT_PROFILE_ID,
    model: '',
    builtIn: true,
    createdAt: now,
    updatedAt: now
  }
}

export function isAssistantCharacter(id: string): boolean {
  return id === ASSISTANT_CHARACTER_ID
}

/** 内置角色是人设/模型的实时视图：仅保留 name/avatar 编辑，其余字段运行期解析。 */
export function normalizeCharacters(value: unknown): Character[] {
  const items: Record<string, unknown>[] = []
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === 'object') items.push(item as Record<string, unknown>)
    }
  }
  let defaultCharacter = createDefaultCharacter()
  for (const input of items) {
    const id = typeof input.id === 'string' ? input.id.trim().slice(0, 128) : ''
    if (!id || !isDefaultCharacter(id)) continue
    const name = typeof input.name === 'string' && input.name.trim()
      ? clampCodePoints(input.name.replace(/\s+/g, ' ').trim(), MAX_CHARACTER_NAME_LENGTH)
      : DEFAULT_CHARACTER_NAME
    const avatar = typeof input.avatar === 'string' && input.avatar.trim() ? clampCodePoints(input.avatar.trim(), 8) : defaultCharacter.avatar
    defaultCharacter = { ...defaultCharacter, name, avatar }
  }
  const names = new Set<string>([defaultCharacter.name, ASSISTANT_CHARACTER_NAME])
  const ids = new Set<string>([DEFAULT_CHARACTER_ID, ASSISTANT_CHARACTER_ID])
  const custom: Character[] = []
  const now = Date.now()
  for (const input of items) {
    const id = typeof input.id === 'string' ? input.id.trim().slice(0, 128) : ''
    if (!id || isDefaultCharacter(id) || isAssistantCharacter(id)) continue
    if (ids.has(id)) continue
    const draft = sanitizeCharacterDraft(input)
    if (!draft) continue
    let characterName = draft.name
    let suffix = 2
    while (names.has(characterName)) characterName = `${draft.name} ${suffix++}`
    names.add(characterName)
    ids.add(id)
    const createdAt = typeof input.createdAt === 'number' && Number.isFinite(input.createdAt) ? input.createdAt : now
    const updatedAt = typeof input.updatedAt === 'number' && Number.isFinite(input.updatedAt) ? input.updatedAt : createdAt
    custom.push({ id, ...draft, name: characterName, builtIn: false, createdAt, updatedAt })
    if (custom.length >= MAX_CHARACTER_COUNT - 1) break
  }
  return [defaultCharacter, createAssistantCharacter(), ...custom]
}

export interface EffectiveChatConfig {
  provider: 'openai' | 'claude'
  baseUrl: string
  apiKey: string
  model: string
  soulMd: string
}

export type CharacterResolution = { ok: true; config: EffectiveChatConfig } | { ok: false; error: string }

export function resolveCharacterConfig(character: Character | undefined | null, config: AppConfig): CharacterResolution {
  if (!character || character.builtIn) {
    if (!isAIConfigured(config)) {
      return { ok: false, error: '内置角色使用设置页的 AI 配置，请先完成 Base URL、API Key 和模型设置。' }
    }
    return {
      ok: true,
      config: { provider: config.provider, baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, soulMd: character?.soulMd || config.soulMd }
    }
  }
  const profile = getProviderProfiles(config).find((item) => item.id === character.providerProfileId)
  if (!profile) return { ok: false, error: `角色「${character.name}」引用的供应商档案已不存在，请在通讯录中重新选择。` }
  if (!profile.baseUrl.trim() || !profile.apiKey.trim()) {
    return { ok: false, error: `档案「${profile.name}」缺少 Base URL 或 API Key，请到设置页补全。` }
  }
  if (!character.model.trim()) return { ok: false, error: `角色「${character.name}」尚未设置模型，请在通讯录中补全。` }
  return {
    ok: true,
    config: { provider: profile.provider, baseUrl: profile.baseUrl, apiKey: profile.apiKey, model: character.model, soulMd: character.soulMd || DEFAULT_SOUL_MD }
  }
}
