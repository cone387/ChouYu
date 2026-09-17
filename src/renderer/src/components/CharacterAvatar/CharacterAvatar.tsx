import { ASSISTANT_CHARACTER_ID, DEFAULT_CHARACTER_ID } from '../../../../shared/characters'
import './CharacterAvatar.css'

export interface AvatarIdentity {
  id: string
  name: string
  avatar: string
}

/** Identity colors stay stable when the application accent or contact name changes. */
export function avatarPresentation(character?: AvatarIdentity | null) {
  const avatar = character?.avatar.trim() || ''
  if (character?.id === DEFAULT_CHARACTER_ID && (!avatar || avatar === '🐟')) {
    return { kind: 'fish', tone: 'teal', text: '' }
  }
  if (character?.id === ASSISTANT_CHARACTER_ID && (!avatar || avatar === '🔔')) {
    return { kind: 'assistant', tone: 'blue', text: '' }
  }
  const tones = ['blue', 'teal', 'violet', 'rose', 'amber']
  const hash = Array.from(character?.id || '').reduce((value, char) => (value * 31 + char.codePointAt(0)!) >>> 0, 0)
  const initial = character?.name.trim() ? Array.from(new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(character.name.trim()))[0].segment : '?'
  return { kind: 'text', tone: character ? tones[hash % tones.length] : 'neutral', text: avatar || initial }
}

export default function CharacterAvatar({ character }: { character?: AvatarIdentity | null }) {
  const { kind, tone, text } = avatarPresentation(character)
  return <span className="character-avatar" data-avatar-kind={kind} data-avatar-tone={tone} aria-hidden="true">
    {kind === 'fish' ? <svg viewBox="0 0 48 48" fill="none" focusable="false">
      <path d="M17 17c-4-1-7-4-9-3-2 2-1 6 1 10-2 4-3 8-1 10 2 1 5-2 9-3" fill="currentColor" opacity=".5" />
      <path d="M23 14c0-4 3-6 7-5l2 7" fill="currentColor" opacity=".55" />
      <path d="M13 24c0-7 6-12 13-12 8 0 14 6 14 12s-6 12-14 12c-7 0-13-5-13-12Z" fill="currentColor" />
      <path d="M19 28c2-2 5-2 7 0-1 4-5 5-7 0Z" fill="var(--avatar-highlight)" opacity=".55" />
      <circle cx="31" cy="21" r="4" fill="var(--avatar-highlight)" />
      <circle cx="32" cy="21" r="1.8" fill="var(--avatar-ink)" />
      <path d="M32 29c1.5 1 3 1 4-.5" stroke="var(--avatar-highlight)" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="39" cy="9" r="2" fill="currentColor" opacity=".35" />
    </svg> : kind === 'assistant' ? <svg viewBox="0 0 48 48" fill="none" focusable="false">
      <path d="M14 29h20l-3-5v-5a7 7 0 0 0-14 0v5l-3 5Z" fill="currentColor" opacity=".18" />
      <path d="M14 29h20l-3-5v-5a7 7 0 0 0-14 0v5l-3 5ZM21 34a3.5 3.5 0 0 0 6 0M24 9v3" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="35" cy="12" r="3" fill="currentColor" />
    </svg> : <span className="character-avatar-text">{text}</span>}
  </span>
}
