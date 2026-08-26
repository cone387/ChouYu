export interface PendingAttachment {
  type: 'image' | 'text'
  data: string
  name: string
}

export const MAX_ATTACHMENT_COUNT = 4
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_TEXT_BYTES = 2 * 1024 * 1024

function isImageFile(file: Pick<File, 'name' | 'type'>): boolean {
  return file.type.startsWith('image/') || /\.(?:jpe?g|png|gif|bmp|webp)$/i.test(file.name)
}

export function getAttachmentValidationError(
  file: Pick<File, 'name' | 'size' | 'type'>,
  currentCount = 0
): string | null {
  if (currentCount >= MAX_ATTACHMENT_COUNT) {
    return `最多添加 ${MAX_ATTACHMENT_COUNT} 个附件。`
  }

  const isImage = isImageFile(file)
  const maxBytes = isImage ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES
  if (file.size > maxBytes) {
    const maxMb = Math.round(maxBytes / 1024 / 1024)
    return `${file.name} 过大，${isImage ? '图片' : '文本文件'}不能超过 ${maxMb} MB。`
  }
  return null
}

export function readAttachmentFile(file: File): Promise<PendingAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    const isImage = isImageFile(file)
    reader.onerror = () => reject(new Error(`无法读取 ${file.name}`))
    reader.onload = () => resolve({
      type: isImage ? 'image' : 'text',
      data: String(reader.result ?? ''),
      name: file.name
    })
    if (isImage) reader.readAsDataURL(file)
    else reader.readAsText(file)
  })
}
