import type { MaterialRef, MaterialReadRef, MaterialRead } from '../../../../shared/contact-materials'
export async function readMaterialPassage(reference: MaterialRef | Partial<MaterialReadRef>, read: (offset: number) => Promise<MaterialRead>): Promise<MaterialRead> {
  if (!('start' in reference) || reference.start === undefined) return read(0)
  const { start, end } = reference
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(end) || end! <= start) throw Error('资料引用位置无效。')
  let text = '', offset = start, result: MaterialRead
  do {
    result = await read(offset)
    text += result.text.slice(0, end! - offset)
    if (text.length >= end! - start) return { text, ref: result.ref }
    if (result.nextOffset === undefined || result.nextOffset <= offset) throw Error('资料引用范围超出正文。')
    offset = result.nextOffset
  } while (offset < end!)
  throw Error('资料引用范围无效。')
}
