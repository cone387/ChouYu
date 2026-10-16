import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { INDUSTRY_LABELS, MAX_CHARACTER_NAME_LENGTH, sanitizeCharacterDraft, type Character, type CharacterDraft } from './characters'
import { DEFAULT_PROFILE_ID, getProviderProfiles, type AppConfig } from './config'

export type ContactProfilePatch = Partial<CharacterDraft>
export interface ContactProfileSnapshot {
  characterId: string
  builtIn: boolean
  revision: string
  profile: CharacterDraft
  effectiveModel: string
  providers: { id: string; name: string; provider: 'openai' | 'claude' }[]
}
export const contactProfileProperties = {
  harnessEngine: { type: 'string' as const, enum: ['native', 'dsh'], description: '当前联系人的普通聊天执行引擎：native 为 ChouYu 原生；dsh 为 DeepSeek Harness（实验性，仅 Windows，暂不支持图片）；后台任务不受此项影响' },
  name: { type: 'string' as const, description: '联系人显示名字，最多24个字符' },
  avatar: { type: 'string' as const, description: '联系人文字或emoji头像，最多8个字符' },
  category: { type: 'string' as const, description: '分类ID，空字符串清除分类', enum: ['', ...Object.keys(INDUSTRY_LABELS)] },
  soulMd: { type: 'string' as const, description: '完整角色人设，最多50000字符；保留用户未撤销要求；空字符串清空，不能混入公共交流规则' },
  providerProfileId: { type: 'string' as const, description: '从真实供应商目录读取的档案ID，最多128字符；不是密钥' },
  model: { type: 'string' as const, description: '用户指定的模型名称，最多256字符；普通联系人使用默认档案时可留空跟随默认' }
}
export function contactProfileSnapshot(character: Character, config: AppConfig): ContactProfileSnapshot {
  const profile: CharacterDraft = { name: character.name, avatar: character.avatar, category: character.category, harnessEngine: character.harnessEngine ?? 'native',
    soulMd: character.builtIn ? config.soulMd : character.soulMd,
    model: character.builtIn ? config.model : character.model, providerProfileId: character.builtIn ? DEFAULT_PROFILE_ID : character.providerProfileId }
  const providers = getProviderProfiles(config).map(({ id, name, provider }) => ({ id, name, provider }))
  const effectiveModel = character.builtIn || !profile.model ? config.model : profile.model
  const revision = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([character.id, character.updatedAt, profile, effectiveModel, providers]))))
  return { characterId: character.id, builtIn: character.builtIn, revision, profile, effectiveModel, providers }
}
export function validateContactProfilePatch(raw: unknown): ContactProfilePatch {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('联系人资料修改无效。')
  const entries = Object.entries(raw)
  if (!entries.length || entries.some(([key, value]) => !Object.hasOwn(contactProfileProperties, key) || typeof value !== 'string')) throw new Error('联系人资料修改字段无效。')
  const p = raw as ContactProfilePatch
  if (p.harnessEngine !== undefined && p.harnessEngine !== 'native' && p.harnessEngine !== 'dsh') throw new Error('聊天执行引擎无效。')
  if (p.name !== undefined && (!p.name.trim() || Array.from(p.name).length > MAX_CHARACTER_NAME_LENGTH)) throw new Error('联系人名字须为1–24个字符。')
  if (p.avatar !== undefined && Array.from(p.avatar).length > 8) throw new Error('头像最多8个字符。')
  if (p.category !== undefined && p.category !== '' && !Object.hasOwn(INDUSTRY_LABELS, p.category)) throw new Error('联系人分类无效。')
  if (p.soulMd !== undefined && p.soulMd.length > 50000) throw new Error('人设最多50000字。')
  if (p.providerProfileId !== undefined && (!p.providerProfileId.trim() || p.providerProfileId.length > 128)) throw new Error('供应商档案无效。')
  if (p.model !== undefined && p.model.length > 256) throw new Error('模型名称过长。')
  return { ...p }
}
export function applyContactProfilePatch(current: ContactProfileSnapshot, raw: ContactProfilePatch): CharacterDraft {
  const patch = validateContactProfilePatch(raw), merged = { ...current.profile, ...patch }
  if (current.builtIn && merged.providerProfileId !== DEFAULT_PROFILE_ID) throw new Error('内置联系人使用系统默认供应商档案。')
  if (!current.providers.some(p => p.id === merged.providerProfileId)) throw new Error('所选供应商档案已不存在。')
  const input = sanitizeCharacterDraft(merged)
  if (!input) throw new Error('该供应商需要填写模型名称。')
  return input
}
export function describeContactProfilePatch(patch: ContactProfilePatch): string {
  const labels: Record<keyof CharacterDraft, string> = { name: '名字', avatar: '头像', category: '分类', soulMd: '人设', providerProfileId: '供应商档案', model: '模型', harnessEngine: '聊天执行引擎' }
  return Object.entries(patch).map(([key, value]) => key === 'harnessEngine' ? `聊天执行引擎：${value === 'dsh' ? 'DeepSeek Harness' : 'ChouYu 原生'}` : key === 'soulMd' ? `人设：${value ? '已更新' : '已清空'}` : `${labels[key as keyof CharacterDraft]}：${value || (key === 'model' ? '跟随系统默认' : '已清空')}`).join('；')
}
