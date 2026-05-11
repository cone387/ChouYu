export const DEFAULT_PET_SIZE = 80
export const PET_WINDOW_PADDING = 20
export const SNAP_DISTANCE = 40
export const PANEL_WIDTH = 400
export const PANEL_HEIGHT = 520
export const PANEL_COMPACT_HEIGHT = 160
export const PANEL_GAP = 12
export const SLEEP_TIMEOUT = 5 * 60 * 1000
export const MAX_HISTORY_MESSAGES = 30

export const DEFAULT_CONFIG = {
  provider: 'openai' as const,
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o',
  hotkey: 'Alt+Space',
  autoStart: false,
  petSize: DEFAULT_PET_SIZE
}
