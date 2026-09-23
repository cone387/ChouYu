import { lookup } from 'node:dns/promises'
import type { LookupAddress } from 'node:dns'
import { request, type RequestOptions } from 'node:https'
import { isIP } from 'node:net'
import { createHash } from 'node:crypto'
import type { AgentEvidence } from '../../shared/agents'

// Resolve once and pin the connection to the checked address (including redirects).
export function publicAddress(address: string): boolean {
  if (isIP(address) !== 4) return false // IPv6 is deliberately unsupported in this first reader.
  const [a, b] = address.split('.').map(Number)
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51) || a === 203 && b === 0)
}
export function evidenceFromText(url: string, html: string): AgentEvidence {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/<[^>]*>/g, '').trim().slice(0, 200) || new URL(url).hostname
  const text = html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim().slice(0, 12000)
  if (text.length < 40) throw new Error('网页正文过短，无法形成可靠资料。')
  return { url, title, text, capturedAt: Date.now(), hash: createHash('sha256').update(text).digest('hex') }
}
export async function readSource(address: string, signal: AbortSignal, redirects = 0, origin?: string): Promise<AgentEvidence> {
  const url = new URL(address)
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' || origin && url.origin !== origin) throw new Error('仅允许公开 HTTPS 网页及同站跳转。')
  signal.throwIfAborted()
  const resolved = await new Promise<LookupAddress[]>((resolve, reject) => {
    const abort = () => reject(signal.reason || new Error('资料读取已取消。'))
    signal.addEventListener('abort', abort, { once: true })
    lookup(url.hostname, { all: true, family: 4 }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
  signal.throwIfAborted()
  if (!resolved.length || resolved.some(item => !publicAddress(item.address))) throw new Error('资料地址不能指向本机、内网或保留地址。')
  const result = await new Promise<{ html?: string; redirect?: string }>((resolve, reject) => {
    const options: RequestOptions & { autoSelectFamily: boolean } = {
      signal, family: 0, autoSelectFamily: true, headers: { 'User-Agent': 'ChouYu-Agent/1.0', Accept: 'text/html,text/plain,application/xml', 'Accept-Encoding': 'identity' },
      lookup: (_hostname, options, callback) => callback(null, options.all ? resolved : resolved[0].address, 4)
    }
    const req = request(url, options, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); resolve({ redirect: new URL(res.headers.location, url).href }); return }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`资料读取失败（HTTP ${res.statusCode}）。`)); return }
      if (!/^(text\/|application\/(xml|rss\+xml|atom\+xml|json))/.test(res.headers['content-type'] || '')) { res.resume(); reject(new Error('资料必须是文本网页。')); return }
      const chunks: Buffer[] = []; let bytes = 0
      res.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 512 * 1024) { req.destroy(new Error('网页超过 512 KB 读取上限。')); return }; chunks.push(chunk) })
      res.on('error', reject)
      res.on('end', () => resolve({ html: Buffer.concat(chunks).toString('utf8') }))
    })
    req.setTimeout(15000, () => req.destroy(new Error('资料读取超时。')))
    req.on('error', reject); req.end()
  })
  if (result.redirect) { if (redirects >= 3) throw new Error('网页跳转过多。'); return readSource(result.redirect, signal, redirects + 1, origin || url.origin) }
  return evidenceFromText(address, result.html!)
}
