import type { AppConfig } from '../shared/types'

export type ThemePreference = AppConfig['theme']
export type ResolvedTheme = 'light' | 'dark'

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === 'light' || preference === 'dark') return preference
  return systemPrefersDark ? 'dark' : 'light'
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

  const apply = () => {
    document.documentElement.dataset.theme = resolveTheme(preference, media.matches)
  }

  const onMediaChange = () => apply()
  const stopConfigSync = window.electronAPI.onConfigChanged((config) => {
    preference = config.theme
    apply()
  })

  void window.electronAPI.db.getConfig().then((config) => {
    preference = config.theme
    apply()
  }).catch(() => {})

  media.addEventListener('change', onMediaChange)
  apply()

  return () => {
    stopConfigSync()
    media.removeEventListener('change', onMediaChange)
  }
}
