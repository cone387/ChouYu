import { app, protocol } from 'electron'
import { randomUUID } from 'node:crypto'
import type { AgentDelivery } from '../../shared/agent-delivery'
import { deliveryDocument, presentationPolicy } from '../../shared/delivery-presentation'

// Registered before app.ready. Separate origin and opaque sandbox; no Electron bridge.
protocol.registerSchemesAsPrivileged([{ scheme: 'chouyu-artifact', privileges: { standard: true, secure: true } }])
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-frame-navigate', event => {
    if (event.frame?.url.startsWith('chouyu-artifact:') || event.initiator?.url.startsWith('chouyu-artifact:')) event.preventDefault()
  })
})

export function registerPresentationProtocol(read: (characterId: string, topicId: string, version: number) => Promise<{ title: string; artifact: AgentDelivery | null }>) {
  protocol.handle('chouyu-artifact', async request => {
    try {
      const url = new URL(request.url)
      const parts = url.pathname.split('/').filter(Boolean)
      if (request.method !== 'GET' || url.hostname !== 'view' || parts.length !== 3 || !parts.slice(0, 2).every(s => /^[a-zA-Z0-9_-]{1,128}$/.test(s)) || !/^[1-9]\d*$/.test(parts[2])) return new Response('Not found', { status: 404 })
      const version = Number(parts[2])
      if (!Number.isSafeInteger(version)) return new Response('Not found', { status: 404 })
      const { title, artifact } = await read(parts[0], parts[1], version)
      if (!artifact) return new Response('Not found', { status: 404 })
      const nonce = randomUUID()
      return new Response(deliveryDocument(title, artifact, nonce), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': `${presentationPolicy(nonce)}; sandbox allow-scripts`, 'Cache-Control': 'no-store' } })
    } catch { return new Response('成果暂时无法展示，请切换到正文。', { status: 503 }) }
  })
}
