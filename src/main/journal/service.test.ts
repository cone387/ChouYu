import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_JOURNAL_CONFIG } from '../../shared/journal'

const mock = vi.hoisted(() => ({ read: vi.fn(), stop: vi.fn(), idle: vi.fn(), capture: vi.fn(), ocr: vi.fn(), summarize: vi.fn(), answer: vi.fn(), worker: null as any, config: null as any, writes: [] as any[] }))
vi.mock('./summary', () => ({ generateJournalSummary: mock.summarize, answerJournalQuestion: mock.answer }))
vi.mock('../database', () => ({ getConfig: () => ({ model: 'test' }) }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('events')
  return { app: { getPath: () => 'test-only' }, powerMonitor: Object.assign(new EventEmitter(), { getSystemIdleTime: mock.idle }) }
})
vi.mock('./activity-helper', () => ({ ActivityHelper: class { read = mock.read; stop = mock.stop } }))
vi.mock('./capture', () => ({ captureJournalWindow: mock.capture }))
vi.mock('./ocr', () => ({ JournalOcr: class { read = mock.ocr; stop = vi.fn() } }))
vi.mock('worker_threads', () => ({ Worker: class extends EventEmitter {
  constructor() { super(); mock.worker = this }
  postMessage({ id, method, payload }: any) {
    mock.writes.push({ method, payload })
    if (method === 'configure') mock.config = payload
    queueMicrotask(() => this.emit('message', { id, result: method === 'config' || method === 'configure' ? mock.config : method === 'sample' ? 1 : method === 'ocrJob' ? { id: payload, path: 'synthetic-only.jpg' } : method === 'summaryInput' ? { sources: [], truncated: false, generation: 0 } : null }))
  }
  terminate = vi.fn(async () => 0)
} }))
import { powerMonitor } from 'electron'
import { JournalService } from './service'

describe('journal recording lifecycle', () => {
  let service: JournalService
  beforeEach(async () => {
    vi.useFakeTimers(); mock.writes = []; mock.config = { ...DEFAULT_JOURNAL_CONFIG }
    mock.read.mockReset(); mock.stop.mockReset(); mock.idle.mockReturnValue(0)
    mock.read.mockResolvedValue({ app: 'editor.exe', title: '合成工作记录', pid: 123456, hwnd: '100' })
    mock.capture.mockReset(); mock.ocr.mockReset(); mock.summarize.mockReset(); mock.answer.mockReset()
    mock.capture.mockResolvedValue({ bytes: Buffer.from('fake'), width: 100, height: 100 })
    service = new JournalService(); await service.ready
  })
  afterEach(async () => { await service.close().catch(() => {}); vi.useRealTimers() })
  it('does not launch collection until explicitly enabled', async () => {
    await vi.advanceTimersByTimeAsync(20_000)
    expect(mock.read).not.toHaveBeenCalled()
    expect(service.status().state).toBe('off')
  })
  it('cancels a model summary without changing recording settings or saving a late result', async () => {
    let signal: AbortSignal | undefined
    let finish!: (result: any) => void
    mock.summarize.mockImplementation((_input, _config, received) => { signal = received; return new Promise(resolve => { finish = resolve }) })
    const pending = service.summarize({ from: 1, to: 100 }).catch(error => error)
    await vi.advanceTimersByTimeAsync(0)
    expect(mock.summarize).toHaveBeenCalledOnce()
    service.cancelAnalysis()
    expect(signal?.aborted).toBe(true)
    finish({ items: [] })
    expect((await pending).message).toContain('取消')
    expect(mock.writes.some(item => item.method === 'summarySave')).toBe(false)
    expect(service.status().config.enabled).toBe(false)
  })
  it('rejects a journal answer that finishes after deleting its sources', async () => {
    let finish!: (result: any) => void
    mock.answer.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const pending = service.ask({ from: 1, to: 100, question: '在哪？' }).catch(error => error)
    await vi.advanceTimersByTimeAsync(0)
    await service.deleteRange({ from: 1, to: 100 })
    finish({ text: 'late', sourceIds: [] })
    expect((await pending).message).toContain('取消')
  })
  it('discards activity arriving after a pause', async () => {
    let finish!: (value: any) => void
    mock.read.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await service.configure({ enabled: true }); await vi.advanceTimersByTimeAsync(0)
    await service.configure({ paused: true })
    finish({ app: 'editor.exe', title: 'must not persist', pid: 123456 })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(mock.writes.filter(item => item.method === 'sample')).toHaveLength(0)
    expect(service.status().state).toBe('paused')
  })
  it('unlock never resumes a manual pause', async () => {
    await service.configure({ enabled: true, paused: true })
    powerMonitor.emit('lock-screen'); powerMonitor.emit('unlock-screen')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(service.status().state).toBe('paused')
    expect(mock.read).not.toHaveBeenCalled()
  })
  it('does not persist excluded or idle activity', async () => {
    await service.configure({ enabled: true, excludedApps: ['editor.exe'] })
    await vi.advanceTimersByTimeAsync(0)
    expect(service.status().state).toBe('excluded')
    mock.idle.mockReturnValue(130)
    await vi.advanceTimersByTimeAsync(5000)
    expect(service.status().state).toBe('idle')
    expect(mock.writes.filter(item => item.method === 'sample')).toHaveLength(0)
  })
  it('stops sampling if the database worker fails', async () => {
    await service.configure({ enabled: true })
    mock.worker.emit('error', new Error('disk unavailable'))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(service.status().state).toBe('error')
    expect(mock.read).not.toHaveBeenCalled()
    await expect(service.configure({ enabled: false })).rejects.toThrow()
  })
  it('does not capture pictures when only activity recording is enabled', async () => {
    await service.configure({ enabled: true }); await vi.advanceTimersByTimeAsync(10_000)
    expect(mock.capture).not.toHaveBeenCalled()
  })
  it('discards a picture that finishes after pause', async () => {
    let finish!: (value: unknown) => void
    mock.capture.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await service.configure({ enabled: true, captureEnabled: true }); await vi.advanceTimersByTimeAsync(0)
    await service.configure({ paused: true }); finish({ bytes: Buffer.from('fake'), width: 100, height: 100 })
    await vi.advanceTimersByTimeAsync(0)
    expect(mock.writes.some(item => item.method === 'capture')).toBe(false)
  })
  it('discards a picture if the foreground window changed during capture', async () => {
    mock.read.mockResolvedValueOnce({ app: 'editor.exe', title: 'A', pid: 123456, hwnd: '100' }).mockResolvedValueOnce({ app: 'editor.exe', title: 'B', pid: 123456, hwnd: '100' })
    await service.configure({ enabled: true, captureEnabled: true }); await vi.advanceTimersByTimeAsync(0)
    expect(mock.writes.some(item => item.method === 'capture')).toBe(false)
  })
  it('allows explicit OCR without enabling recording and prevents late writes after deletion', async () => {
    let finish!: (value: string) => void
    mock.ocr.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const operation = service.retryOcr('00000000-0000-4000-8000-000000000001')
    await vi.advanceTimersByTimeAsync(0)
    await service.deleteRange({ from: 0, to: 86400_000 }); finish('deleted text'); await operation
    expect(mock.writes.some(item => item.method === 'ocrDone')).toBe(false)
    expect(service.status().config.enabled).toBe(false)
  })
})
