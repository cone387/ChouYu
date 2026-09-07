import { desktopCapturer } from 'electron'
import { createHash } from 'crypto'

let acquiring = false

/** Match native HWND, never guess by title and never fall back to the whole screen. */
export async function captureJournalWindow(hwnd: string) {
  if (!/^\d+$/.test(hwnd)) throw new Error('窗口标识无效。')
  if (acquiring) throw new Error('上一轮画面采集尚未结束，已跳过。')
  acquiring = true
  const acquisition = desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1920, height: 1080 }, fetchWindowIcons: false }).finally(() => { acquiring = false })
  let timer: ReturnType<typeof setTimeout> | undefined
  const sources = await Promise.race([
    acquisition,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('窗口画面采集超时，活动记录仍会继续。')), 8000) })
  ]).finally(() => clearTimeout(timer))
  const source = sources.find(item => item.id.split(':')[1] === hwnd)
  if (!source || source.thumbnail.isEmpty()) throw new Error('当前窗口无法采集画面，活动记录仍会继续。')
  const { width, height } = source.thumbnail.getSize()
  if (width < 32 || height < 32) throw new Error('窗口画面过小，已跳过。')
  const bytes = source.thumbnail.toJPEG(88)
  return { bytes, width, height, hash: createHash('sha256').update(bytes).digest('hex') }
}
