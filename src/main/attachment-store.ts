import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'

const PREFIX = 'chouyu-attachment:'
const REFERENCE = /^chouyu-attachment:([a-f0-9]{64})\.(png|jpeg|gif|webp|bmp|avif)$/

export function isAttachmentReference(value: string): boolean {
  return REFERENCE.test(value)
}

/** Only application-owned, content-addressed files can be read through this store. */
export class AttachmentStore {
  constructor(private readonly directory: string) {}

  persist(imageUrl: string | undefined): string | undefined {
    if (!imageUrl?.startsWith('data:')) return imageUrl
    const match = /^data:image\/(png|jpeg|jpg|gif|webp|bmp|avif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(imageUrl)
    if (!match) throw new Error('Unsupported image attachment')
    const extension = match[1] === 'jpg' ? 'jpeg' : match[1]
    const bytes = Buffer.from(match[2], 'base64')
    if (!bytes.length || bytes.toString('base64').replace(/=+$/, '') !== match[2].replace(/=+$/, '')) {
      throw new Error('Invalid image attachment')
    }
    const hash = createHash('sha256').update(bytes).digest('hex')
    const filename = `${hash}.${extension}`
    const target = path.join(this.directory, filename)
    fs.mkdirSync(this.directory, { recursive: true })
    if (!fs.existsSync(target)) {
      const temporary = `${target}.tmp`
      const descriptor = fs.openSync(temporary, 'w')
      try {
        fs.writeFileSync(descriptor, bytes)
        fs.fsyncSync(descriptor)
      } finally {
        fs.closeSync(descriptor)
      }
      fs.renameSync(temporary, target)
    }
    return PREFIX + filename
  }

  read(imageUrl: string | undefined): string | undefined {
    if (!imageUrl?.startsWith(PREFIX)) return imageUrl
    const match = REFERENCE.exec(imageUrl)
    if (!match) throw new Error('Invalid attachment reference')
    const bytes = fs.readFileSync(path.join(this.directory, `${match[1]}.${match[2]}`))
    if (createHash('sha256').update(bytes).digest('hex') !== match[1]) throw new Error('Damaged attachment')
    return `data:image/${match[2]};base64,${bytes.toString('base64')}`
  }
}
