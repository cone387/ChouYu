import { describe, expect, it } from 'vitest'
import {
  getAttachmentValidationError,
  MAX_ATTACHMENT_COUNT,
  MAX_IMAGE_BYTES,
  MAX_TEXT_BYTES
} from './attachments'

describe('attachment validation', () => {
  it('accepts files within the supported size limits', () => {
    expect(getAttachmentValidationError({ name: 'image.png', type: 'image/png', size: MAX_IMAGE_BYTES })).toBeNull()
    expect(getAttachmentValidationError({ name: 'image.png', type: '', size: MAX_IMAGE_BYTES })).toBeNull()
    expect(getAttachmentValidationError({ name: 'notes.md', type: 'text/markdown', size: MAX_TEXT_BYTES })).toBeNull()
  })

  it('rejects oversized files with a useful message', () => {
    expect(getAttachmentValidationError({ name: 'large.png', type: 'image/png', size: MAX_IMAGE_BYTES + 1 })).toContain('10 MB')
    expect(getAttachmentValidationError({ name: 'large.txt', type: 'text/plain', size: MAX_TEXT_BYTES + 1 })).toContain('2 MB')
  })

  it('limits the number of attachments', () => {
    expect(getAttachmentValidationError(
      { name: 'notes.txt', type: 'text/plain', size: 1 },
      MAX_ATTACHMENT_COUNT
    )).toContain(`最多添加 ${MAX_ATTACHMENT_COUNT} 个附件`)
  })
})
