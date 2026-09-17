import { describe, expect, it } from 'vitest'
import { avatarPresentation } from './CharacterAvatar'
import { ASSISTANT_CHARACTER_ID, DEFAULT_CHARACTER_ID } from '../../../../shared/characters'

describe('contact avatar identity', () => {
  it('gives the two built-in contacts different artwork', () => {
    expect(avatarPresentation({ id: DEFAULT_CHARACTER_ID, name: '丑鱼', avatar: '🐟' }).kind).toBe('fish')
    expect(avatarPresentation({ id: ASSISTANT_CHARACTER_ID, name: '助手', avatar: '🔔' }).kind).toBe('assistant')
  })
  it('preserves custom avatars, including edits to the built-in fish', () => {
    const identity = { id: DEFAULT_CHARACTER_ID, name: '小鱼干', avatar: '🐠' }
    expect(avatarPresentation(identity)).toMatchObject({ kind: 'text', text: '🐠' })
    expect(avatarPresentation({ ...identity, id: 'custom', avatar: '🐟' })).toMatchObject({ kind: 'text', text: '🐟' })
  })
  it('keeps the contact color stable across renaming and avatar edits', () => {
    expect(avatarPresentation({ id: 'mentor', name: '老周', avatar: '👨‍💻' }).tone)
      .toBe(avatarPresentation({ id: 'mentor', name: '代码导师', avatar: '周' }).tone)
  })
  it('does not misidentify unavailable contacts as the fish and preserves compound initials', () => {
    expect(avatarPresentation(null)).toMatchObject({ kind: 'text', tone: 'neutral', text: '?' })
    expect(avatarPresentation({ id: 'custom', name: '👨‍💻导师', avatar: '' }).text).toBe('👨‍💻')
  })
})
