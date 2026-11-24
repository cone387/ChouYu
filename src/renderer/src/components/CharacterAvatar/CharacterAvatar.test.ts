import { describe, expect, it } from 'vitest'
import { avatarPresentation } from './CharacterAvatar'
import { ASSISTANT_CHARACTER_ID, DEFAULT_CHARACTER_ID } from '../../../../shared/characters'
import { PRESET_CHARACTERS, sanitizeCharacterDraft } from '../../../../shared/characters'
import { RESULT_DESIGNER_CHARACTER_ID } from '../../../../shared/result-design'
import { avatarDraftIdentity } from './builtinAvatars'

describe('contact avatar identity', () => {
  it('shows the approved fish for ChouYu and the legacy assistant', () => {
    const fish = avatarPresentation({ id: DEFAULT_CHARACTER_ID, name: '丑鱼', avatar: '🐟' })
    expect(fish.kind).toBe('image')
    expect(avatarPresentation({ id: ASSISTANT_CHARACTER_ID, name: '助手', avatar: '🔔' }).src).toBe(fish.src)
  })
  it('upgrades existing defaults without depending on their current names', () => {
    const defaults = [...PRESET_CHARACTERS, { id: RESULT_DESIGNER_CHARACTER_ID, name: '设计师', avatar: '🎨' }]
    const sources = defaults.map(character => avatarPresentation({ ...character, name: '已改名' }))
    expect(sources.every(item => item.kind === 'image' && item.src)).toBe(true)
    expect(new Set(sources.map(item => item.src)).size).toBe(defaults.length)
    for (const character of defaults) {
      expect(avatarPresentation({ ...character, avatar: '自' }).src).toBe(avatarPresentation(character).src)
    }
  })
  it('lets custom contacts choose a built-in image and preserves the token through validation', () => {
    const input = sanitizeCharacterDraft({ name: '自定义', avatar: '@design', soulMd: '', category: '' })!
    expect(input.avatar).toBe('@design')
    expect(avatarPresentation({ ...input, id: 'custom' })).toMatchObject({ kind: 'image' })
  })
  it('normalizes legacy editor values to the same selected image token that will be saved', () => {
    const draft = { id: DEFAULT_CHARACTER_ID, name: '丑鱼', avatar: '' }
    expect(avatarDraftIdentity(draft).avatar).toBe('@fish')
    expect(avatarPresentation(avatarDraftIdentity(draft)).src).toBe(avatarPresentation(draft).src)
  })
  it('replaces legacy custom emoji and text with stable illustrations', () => {
    const identity = { id: DEFAULT_CHARACTER_ID, name: '小鱼干', avatar: '🐠' }
    expect(avatarPresentation(identity)).toMatchObject({ kind: 'image' })
    const custom = avatarPresentation({ ...identity, id: 'custom', avatar: '🐟' })
    expect(custom.kind).toBe('image')
    expect(custom.src).toBe(avatarPresentation({ id: 'custom', name: '改名', avatar: '字' }).src)
    expect(custom.src).not.toBe(avatarPresentation(identity).src)
  })
  it('keeps the contact color stable across renaming and avatar edits', () => {
    expect(avatarPresentation({ id: 'mentor', name: '老周', avatar: '👨‍💻' }).tone)
      .toBe(avatarPresentation({ id: 'mentor', name: '代码导师', avatar: '周' }).tone)
  })
  it('uses a neutral fallback for unavailable contacts and never falls back to emoji', () => {
    expect(avatarPresentation(null)).toMatchObject({ kind: 'text', tone: 'neutral', text: '?' })
    expect(avatarPresentation({ id: 'custom', name: '👨‍💻导师', avatar: '' }).text).toBe('导')
  })
})
