import { ipcMain } from 'electron'

// Opt-in isolated smoke measurements: protocol names and timings only.
let samples: { channel: string; owner?: string; milliseconds: number }[] | undefined
let failure: { channel: string; owner: string } | undefined
export function failContactReadForSmoke(owner?: string) {
  if (process.env.CHOUYU_SMOKE_TEST !== '1') throw Error('Isolated smoke only')
  failure = owner ? { channel: 'agents:delivery', owner } : undefined
}
export function beginContactQueryMeasurement() { samples = [] }
export function endContactQueryMeasurement() { const result = samples ?? []; samples = undefined; return result }
export const contactHandle: typeof ipcMain.handle = (channel, listener) => {
  ipcMain.handle(channel, async (event, ...args) => {
    if (failure?.channel === channel && failure.owner === args[0]) throw Error('CONTACT_READ_RESTART_FIXTURE')
    if (!samples) return listener(event, ...args)
    const target = samples, start = performance.now()
    try { return await listener(event, ...args) }
    finally { target?.push({ channel, ...(typeof args[0] === 'string' ? { owner: args[0] } : {}), milliseconds: performance.now() - start }) }
  })
}
