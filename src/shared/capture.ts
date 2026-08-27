export type CaptureSourceKind = 'screen' | 'window'
export type VisualQuickAction = 'ocr' | 'summarize' | 'translate'

export interface CaptureSourceInfo {
  id: string
  name: string
  kind: CaptureSourceKind
  thumbnail: string
  appIcon?: string
}

export const VISUAL_ACTION_PROMPTS: Record<VisualQuickAction, string> = {
  ocr: '请识别图片中的全部文字，保持原有段落和顺序。只输出识别结果；无法辨认的部分用 [无法识别] 标注。',
  summarize: '请概括这张图片或窗口截图的主要内容，先给出一句话结论，再列出关键点。',
  translate: '请识别图片中的文字并翻译成中文；如果原文已经是中文，则翻译成英文。保留原有段落结构。'
}

export function getCaptureSourceKind(id: string): CaptureSourceKind {
  return id.startsWith('screen:') ? 'screen' : 'window'
}

export function isValidCaptureSourceId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 256
    && /^(screen|window):[\w:-]+$/.test(value)
}

export function filterCaptureSources<T extends { name: string }>(sources: readonly T[], appName: string): T[] {
  const excluded = appName.trim().toLowerCase()
  return sources.filter((source) => {
    const name = source.name.trim().toLowerCase()
    return Boolean(name) && (!excluded || (name !== excluded && !name.startsWith(`${excluded} -`)))
  })
}
