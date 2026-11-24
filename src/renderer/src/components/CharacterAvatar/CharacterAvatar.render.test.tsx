// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import CharacterAvatar from './CharacterAvatar'
import { BUILTIN_AVATARS } from './builtinAvatars'
import { sanitizeCharacterDraft } from '../../../../shared/characters'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('falls back on a broken image and loads a different selected image without showing internal tokens', async () => {
  const host = document.createElement('div'), root = createRoot(host)
  const render = async (avatar: string) => { await act(async () => root.render(<CharacterAvatar character={{ id: 'custom', name: '测试', avatar }} />)) }
  try {
    await render('@design')
    expect(host.querySelector('img')?.getAttribute('alt')).toBe('')
    await act(async () => host.querySelector('img')!.dispatchEvent(new Event('error')))
    expect(host.querySelector('img')).toBeNull()
    expect(host.textContent).toBe('测')
    await render('@zhou')
    expect(host.querySelector('img')).not.toBeNull()
    await render('猫')
    // This legacy identity resolves back to the failed designer image: retain the neutral fallback.
    expect(host.querySelector('img')).toBeNull()
    expect(host.textContent).toBe('测')
  } finally { await act(async () => root.unmount()) }
})

it('all gallery selections survive the existing avatar field validation', () => {
  for (const artwork of BUILTIN_AVATARS) {
    expect(sanitizeCharacterDraft({ name: '新角色', avatar: artwork.token })?.avatar).toBe(artwork.token)
  }
})
