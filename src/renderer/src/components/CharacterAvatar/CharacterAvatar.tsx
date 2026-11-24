import { useState } from 'react'
import { builtinAvatar } from './builtinAvatars'
import './CharacterAvatar.css'

export interface AvatarIdentity {
  id: string
  name: string
  avatar: string
}

/** Legacy avatars resolve to bundled artwork; failed images use a neutral name initial. */
export function avatarPresentation(character?: AvatarIdentity | null): { kind: 'image' | 'text'; tone: string; text: string; src?: string } {
  const artwork = builtinAvatar(character)
  const tones = ['blue', 'teal', 'violet', 'rose', 'amber']
  const hash = Array.from(character?.id || '').reduce((value, char) => (value * 31 + char.codePointAt(0)!) >>> 0, 0)
  const initial = Array.from(character?.name ?? '').find(char => /[\p{L}\p{N}]/u.test(char)) ?? '?'
  return { kind: artwork ? 'image' : 'text', tone: character ? tones[hash % tones.length] : 'neutral',
    text: initial, src: artwork?.src }
}

export default function CharacterAvatar({ character }: { character?: AvatarIdentity | null }) {
  const { kind, tone, text, src } = avatarPresentation(character)
  const [failedSource, setFailedSource] = useState<string>()
  const showImage = kind === 'image' && src !== failedSource
  return <span className="character-avatar" data-avatar-kind={showImage ? 'image' : 'text'} data-avatar-tone={tone} aria-hidden="true">
    {showImage ? <img src={src} alt="" draggable={false} onError={() => setFailedSource(src)} />
      : <span className="character-avatar-text">{text}</span>}
  </span>
}
