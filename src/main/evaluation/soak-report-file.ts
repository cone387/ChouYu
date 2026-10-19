import { promises as fs } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'

export async function writeSoakReport(file: string, value: unknown): Promise<void> {
  const temporary = file + '.tmp'
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), 'utf8')
  // Windows readers can briefly prevent replacement of the destination. Keep
  // the previous complete report visible and retry only that atomic operation.
  const waits = [25, 50, 100, 250]
  for (let attempt = 0; ; attempt++) {
    try { await fs.rename(temporary, file); return } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '') || attempt >= waits.length) throw error
      await delay(waits[attempt])
    }
  }
}
