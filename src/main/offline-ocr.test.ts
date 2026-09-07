import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ directory: '', execFile: vi.fn(), isEmpty: false, width: 900 }))
vi.mock('electron', () => ({
  app: { getPath: () => mocks.directory, getAppPath: () => process.cwd(), isPackaged: false },
  nativeImage: { createFromDataURL: () => ({ isEmpty: () => mocks.isEmpty, getSize: () => ({ width: mocks.width, height: 180 }), toPNG: () => Buffer.from('fixture') }) }
}))
vi.mock('child_process', () => ({ execFile: mocks.execFile }))
import { recognizeOfflineImage } from './offline-ocr'

const data = 'data:image/png;base64,Zml4dHVyZQ=='
beforeEach(() => {
  mocks.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chouyu-ocr-test-'))
  mocks.execFile.mockReset()
  mocks.isEmpty = false
  mocks.width = 900
})
afterEach(() => {
  expect(fs.readdirSync(mocks.directory)).toEqual([])
  fs.rmdirSync(mocks.directory)
})

describe.skipIf(process.platform !== 'win32')('offline OCR process boundary', () => {
  it('rejects malformed, excessive and empty images before launching a process', async () => {
    await expect(recognizeOfflineImage('file:///private.png')).rejects.toThrow('格式')
    await expect(recognizeOfflineImage('x'.repeat(22_000_001))).rejects.toThrow('格式')
    mocks.isEmpty = true
    await expect(recognizeOfflineImage(data)).rejects.toThrow('无法读取')
    expect(mocks.execFile).not.toHaveBeenCalled()
  })

  it('sends only a temporary image path on stdin, bounds the process and removes the file', async () => {
    mocks.execFile.mockImplementation((_command, args, options, callback) => ({ stdin: { on: vi.fn(), end: (request: string) => {
      const imagePath = JSON.parse(request).path
      expect(fs.readFileSync(imagePath, 'utf8')).toBe('fixture')
      expect(args).not.toContain('-ExecutionPolicy')
      expect(options).toMatchObject({ windowsHide: true, timeout: 30000, maxBuffer: 1000000 })
      expect(Object.keys(options.env)).toEqual(['SystemRoot', 'TEMP', 'TMP'])
      callback(null, JSON.stringify({ ok: true, text: '识别结果', language: 'zh-Hans-CN' }))
    } } }))
    await expect(recognizeOfflineImage(data)).resolves.toEqual({ text: '识别结果', language: 'zh-Hans-CN' })
  })

  it('reports unavailable language packs without sending the image to a provider', async () => {
    mocks.execFile.mockImplementation((_command, _args, _options, callback) => ({ stdin: { on: vi.fn(), end: () => callback(new Error('exit 1'), JSON.stringify({ ok: false, error: 'No OCR language pack available' })) } }))
    await expect(recognizeOfflineImage(data)).rejects.toThrow('language pack')
  })

  it('rejects parallel requests, cleans up a timeout and permits retry', async () => {
    let finish!: () => void
    mocks.execFile.mockImplementation((_command, _args, _options, callback) => ({ stdin: { on: vi.fn(), end: () => { finish = () => callback(Object.assign(new Error('timeout'), { killed: true }), '') } } }))
    const pending = recognizeOfflineImage(data)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await expect(recognizeOfflineImage(data)).rejects.toThrow('正在识别')
    const rejection = expect(pending).rejects.toThrow('超时')
    finish()
    await rejection
    mocks.execFile.mockImplementation((_command, _args, _options, callback) => ({ stdin: { on: vi.fn(), end: () => callback(null, '{"ok":true,"text":"","language":"en"}') } }))
    await expect(recognizeOfflineImage(data)).resolves.toEqual({ text: '', language: 'en' })
  })
})
