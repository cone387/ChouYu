import { ASSISTANT_CHARACTER_ID, DEFAULT_CHARACTER_ID, PRESET_CHARACTERS } from '../../../../shared/characters'
import { RESULT_DESIGNER_CHARACTER_ID } from '../../../../shared/result-design'
import fish from '../../assets/avatars/fish.png'
import designer from '../../assets/avatars/designer.png'
import zhou from '../../assets/avatars/zhou.png'
import mei from '../../assets/avatars/mei.png'
import lin from '../../assets/avatars/lin.png'
import bai from '../../assets/avatars/bai.png'
import zheng from '../../assets/avatars/zheng.png'
import emma from '../../assets/avatars/emma.png'
import bi from '../../assets/avatars/bi.png'
import qian from '../../assets/avatars/qian.png'
import yuanfang from '../../assets/avatars/yuanfang.png'
import chuan from '../../assets/avatars/chuan.png'
import yan from '../../assets/avatars/yan.png'
import buddy from '../../assets/avatars/buddy.png'

/** Short persistent tokens fit the existing eight-code-point avatar field. */
export const BUILTIN_AVATARS = [
  { token: '@fish', label: '丑鱼', src: fish, characterId: DEFAULT_CHARACTER_ID },
  { token: '@design', label: '设计师', src: designer, characterId: RESULT_DESIGNER_CHARACTER_ID },
  ...[
    ['@zhou', zhou, 'preset-mentor-zhou'], ['@mei', mei, 'preset-pm-mei'],
    ['@lin', lin, 'preset-counselor-lin'], ['@bai', bai, 'preset-doctor-bai'],
    ['@zheng', zheng, 'preset-lawyer-zheng'], ['@emma', emma, 'preset-emma'],
    ['@bi', bi, 'preset-copywriter-bi'], ['@qian', qian, 'preset-accountant-qian'],
    ['@travel', yuanfang, 'preset-travel-yuanfang'], ['@chuan', chuan, 'preset-chef-chuan'],
    ['@yan', yan, 'preset-interviewer-yan'], ['@study', buddy, 'preset-study-buddy']
  ].map(([token, src, characterId]) => {
    const preset = PRESET_CHARACTERS.find(item => item.id === characterId)!
    return { token, src, characterId, label: preset.name.split('·')[0] }
  })
] as const

export function builtinAvatar(character?: { id: string; avatar: string } | null) {
  if (!character) return undefined
  const avatar = character.avatar.trim()
  const selected = BUILTIN_AVATARS.find(item => item.token === avatar)
  if (selected) return selected
  if (character.id === ASSISTANT_CHARACTER_ID) return BUILTIN_AVATARS[0]
  const preset = BUILTIN_AVATARS.find(item => item.characterId === character.id)
  if (preset) return preset
  // Legacy custom contacts receive a stable portrait, independent of name/old emoji.
  const hash = Array.from(character.id).reduce((value, char) => (value * 31 + char.codePointAt(0)!) >>> 0, 0)
  return BUILTIN_AVATARS[1 + hash % (BUILTIN_AVATARS.length - 1)]
}

/** The preview and saved draft use exactly the same resolved artwork token. */
export function avatarDraftIdentity(form: { id: string | null; name: string; avatar: string }) {
  const id = form.id ?? 'draft'
  return { id, name: form.name, avatar: builtinAvatar({ id, avatar: form.avatar })!.token }
}
