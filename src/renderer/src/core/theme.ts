import type { AppConfig } from '../shared/types'
import { isPaletteId, type PaletteId } from '../../../shared/config'

export type ThemePreference = AppConfig['theme']
export type ResolvedTheme = 'light' | 'dark'
export type PalettePreference = AppConfig['palette']

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === 'light' || preference === 'dark') return preference
  return systemPrefersDark ? 'dark' : 'light'
}

export function resolvePalette(value: unknown): PaletteId {
  return isPaletteId(value) ? value : 'purple'
}

/**
 * Applies the configured theme to <html data-theme="..."> and keeps it in
 * sync with both config changes (broadcast as `config:changed`) and OS-level
 * light/dark switches while the preference is `system`.
 *
 * Returns a cleanup function.
 */
export function initTheme(): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  let preference: ThemePreference = 'system'
  let palettePreference: PalettePreference = 'purple'

  const apply = () => {
    document.documentElement.dataset.theme = resolveTheme(preference, media.matches)
    document.documentElement.dataset.palette = resolvePalette(palettePreference)
  }

  const onMediaChange = () => apply()
  const stopConfigSync = window.electronAPI.onConfigChanged((config) => {
    preference = config.theme
    palettePreference = config.palette
    apply()
  })

  void window.electronAPI.db.getConfig().then((config) => {
    preference = config.theme
    palettePreference = config.palette
    apply()
  }).catch(() => {})

  media.addEventListener('change', onMediaChange)
  apply()

  return () => {
    stopConfigSync()
    media.removeEventListener('change', onMediaChange)
  }
}
