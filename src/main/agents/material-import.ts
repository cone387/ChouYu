import { basename, extname } from 'node:path'
import type { MaterialImport, MaterialInput } from '../../shared/contact-materials'
export function decodeMaterialFile(name: string, data: Uint8Array) {
  if (!['.txt', '.md', '.markdown'].includes(extname(name).toLowerCase())) throw new Error('仅支持 .txt、.md、.markdown 文本资料。')
  if (data.byteLength > 2 * 1024 * 1024) throw new Error('单份资料不得超过 2 MB。')
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(data) } catch { throw new Error('文件不是有效的 UTF-8 文本。') }
  if (text.includes('\0')) throw new Error('文件含空字符，不能作为文本导入。')
  return text
}
export async function loadMaterialImport(input: MaterialImport, deps: { chooseFile(): Promise<{ name: string; data: Uint8Array } | null>; readWeb(url: string, signal: AbortSignal): Promise<string>; allowed(url: string): Promise<boolean> }, signal: AbortSignal): Promise<MaterialInput | null> {
  signal.throwIfAborted()
  let content = input.content, source = input.source
  if (source.kind === 'file') {
    const file = await deps.chooseFile(); signal.throwIfAborted(); if (!file) return null
    content = decodeMaterialFile(file.name, file.data); source = { kind: 'file', label: basename(file.name) }
  } else if (source.kind === 'attachment') {
    content = decodeMaterialFile(source.label, Buffer.from(content ?? '', 'utf8')); source = { kind: 'attachment', label: basename(source.label) }
  } else if (source.kind === 'web') {
    if (!source.url || !await deps.allowed(source.url)) throw new Error('此网页不在当前允许读取的资料范围内，请先调整工作设置。')
    content = await deps.readWeb(source.url, signal)
    if (!await deps.allowed(source.url)) throw new Error('读取权限已变化，资料未保存。')
    source = { kind: 'web', label: source.url, url: source.url }
  }
  signal.throwIfAborted()
  if (typeof content !== 'string') throw new Error('资料没有正文。')
  return { name: input.name, scope: input.scope, source, content }
}
