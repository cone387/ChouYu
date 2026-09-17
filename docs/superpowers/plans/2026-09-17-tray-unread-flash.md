# 托盘未读闪动与消息中心入口 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 有未读助手消息时托盘图标微信式闪动(600ms 正常↔透明交替),点托盘直接打开消息中心并停闪;托盘右键菜单和宠物红点提供常驻入口。

**Architecture:** 渲染进程在消息列表每次变化时通过新 IPC 通道 `proactive-unread-changed` 推送未读数给主进程;主进程 `TrayFlasher`(纯逻辑类,注入两个回调)驱动图标交替;托盘单击按未读数路由(开消息中心或开聊天);主进程经 `open-messages-center` 通道让渲染进程打开 ProactiveCenter 并标读,未读归零后停闪。

**Tech Stack:** Electron Tray(setImage 交替)、preload ipcRenderer、React useEffect、vitest(fake timers)。

**基线分支:** 从 `fix/workspace-session-list-toggle` 拉 `feat/tray-unread-flash`(该分支含本设计与本计划文档,且其会话列表修复尚未合入 master;合并时携带或先合 fix 均可,由用户定)。

**Spec:** `docs/superpowers/specs/2026-09-17-tray-unread-flash-design.md`

---

### Task 1: 建分支 + 透明图标常量

**Files:**
- Create: nothing
- Modify: `src/shared/pet-icon.ts`

- [ ] **Step 1: 建 feature 分支**

```bash
git checkout fix/workspace-session-list-toggle
git checkout -b feat/tray-unread-flash
git status
```

Expected: 新分支,工作区干净。

- [ ] **Step 2: 在 `src/shared/pet-icon.ts` 末尾追加常量**

在 `PET_ICON_PNG_BASE64` 常量之后追加(16×16 全透明 PNG,已生成验证):

```ts

// Fully transparent 16x16 PNG used as the "blank" phase of tray unread flashing.
export const TRANSPARENT_ICON_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAEklEQVR42mNgGAWjYBSMAggAAAQQAAGvRYgsAAAAAElFTkSuQmCC'
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/pet-icon.ts
git commit -m "feat(tray): add transparent icon constant for unread flashing"
```

---

### Task 2: TrayFlasher 纯逻辑类(TDD)

**Files:**
- Create: `src/main/tray-flasher.ts`
- Test: `src/main/tray-flasher.test.ts`

不 import electron,闪烁逻辑全部通过注入的 `showNormal`/`showBlank` 回调表现,可在 node 环境单测。

- [ ] **Step 1: 写失败测试 `src/main/tray-flasher.test.ts`**

```ts
import { afterEach, describe, expect, test, vi } from 'vitest'
import { TrayFlasher } from './tray-flasher'

afterEach(() => vi.useRealTimers())

describe('TrayFlasher', () => {
  test('start 后按周期在 blank 与 normal 间交替', () => {
    vi.useFakeTimers()
    const showNormal = vi.fn()
    const showBlank = vi.fn()
    const flasher = new TrayFlasher({ showNormal, showBlank, intervalMs: 600 })
    flasher.start()
    vi.advanceTimersByTime(599)
    expect(showBlank).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(showBlank).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(600)
    expect(showNormal).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1200)
    expect(showBlank).toHaveBeenCalledTimes(2)
    expect(showNormal).toHaveBeenCalledTimes(2)
    flasher.dispose()
  })

  test('start 幂等;stop 清定时器并恢复 normal;可重启', () => {
    vi.useFakeTimers()
    const showNormal = vi.fn()
    const showBlank = vi.fn()
    const flasher = new TrayFlasher({ showNormal, showBlank })
    expect(flasher.running).toBe(false)
    flasher.start()
    flasher.start()
    expect(flasher.running).toBe(true)
    vi.advanceTimersByTime(600)
    expect(showBlank).toHaveBeenCalledTimes(1)
    flasher.stop()
    expect(flasher.running).toBe(false)
    expect(showNormal).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(600)
    expect(showBlank).toHaveBeenCalledTimes(1)
    flasher.start()
    vi.advanceTimersByTime(600)
    expect(showBlank).toHaveBeenCalledTimes(2)
    flasher.dispose()
    expect(flasher.running).toBe(false)
  })

  test('未 start 时 stop 不调用 showNormal', () => {
    const showNormal = vi.fn()
    const flasher = new TrayFlasher({ showNormal, showBlank: vi.fn() })
    flasher.stop()
    expect(showNormal).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest --run src/main/tray-flasher.test.ts
```

Expected: FAIL,`Cannot find module './tray-flasher'` 或同类导入错误。

- [ ] **Step 3: 实现 `src/main/tray-flasher.ts`**

```ts
export interface TrayFlasherOptions {
  showNormal: () => void
  showBlank: () => void
  intervalMs?: number
}

/** Alternates between two display callbacks on a timer; stop() always restores normal. */
export class TrayFlasher {
  private timer: ReturnType<typeof setInterval> | null = null
  private blank = false

  constructor(private readonly options: TrayFlasherOptions) {}

  get running(): boolean {
    return this.timer !== null
  }

  start(): void {
    if (this.timer) return
    this.blank = false
    this.timer = setInterval(() => {
      this.blank = !this.blank
      if (this.blank) this.options.showBlank()
      else this.options.showNormal()
    }, this.options.intervalMs ?? 600)
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
    this.blank = false
    this.options.showNormal()
  }

  dispose(): void {
    this.stop()
  }
}
```

- [ ] **Step 4: 运行确认通过**

```bash
npx vitest --run src/main/tray-flasher.test.ts
```

Expected: 3 tests PASS。

- [ ] **Step 5: Commit**

```bash
git add src/main/tray-flasher.ts src/main/tray-flasher.test.ts
git commit -m "feat(tray): add TrayFlasher with injected callbacks for unit testing"
```

---

### Task 3: tray.ts 接线(闪烁、IPC、单击路由、菜单、tooltip)

**Files:**
- Modify: `src/main/tray.ts`

无单测(Electron 原生对象),靠 typecheck + 后续整体验证。以下为修改后的**完整 setupTray 及新增模块状态**,按此替换/插入:

- [ ] **Step 1: 修改 import 与模块状态**

`tray.ts` 顶部两行改为:

```ts
import { Tray, Menu, BrowserWindow, MenuItem, app, nativeImage, ipcMain } from 'electron'
import { PET_ICON_PNG_BASE64, TRANSPARENT_ICON_PNG_BASE64 } from '../shared/pet-icon'
import { TrayFlasher } from './tray-flasher'
import { openJournalWorkspace, toggleJournalPause, getJournalStatus } from './journal'
```

模块状态区(`let tray...` 附近)追加:

```ts
let trayUnreadCount = 0
```

- [ ] **Step 2: 重写 `setupTray` 内部**

用以下内容替换现有 `setupTray` 函数体(相对原文件的差异:blankIcon/flasher、openMessages、setTrayUnread + ipc 监听、菜单新增"助手消息"、click 路由、tooltip 拼未读后缀、will-quit 清 flasher):

```ts
export function setupTray(mainWindow: BrowserWindow): void {
  const icon = nativeImage.createFromBuffer(Buffer.from(PET_ICON_PNG_BASE64, 'base64')).resize({ width: 16, height: 16, quality: 'best' })
  if (icon.isEmpty()) throw new Error('Tray icon failed to render')
  tray = new Tray(icon)

  const blankIcon = nativeImage.createFromBuffer(Buffer.from(TRANSPARENT_ICON_PNG_BASE64, 'base64')).resize({ width: 16, height: 16, quality: 'best' })
  const flasher = new TrayFlasher({
    showNormal: () => { if (tray && !tray.isDestroyed()) tray.setImage(icon) },
    showBlank: () => { if (tray && !tray.isDestroyed()) tray.setImage(blankIcon) }
  })

  const openChatPanel = () => {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    mainWindow.moveTop()
    mainWindow.webContents.send('open-chat-panel')
  }

  const openMessages = () => {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    mainWindow.moveTop()
    mainWindow.setIgnoreMouseEvents(false)
    mainWindow.webContents.send('open-messages-center')
  }

  const contextMenu = Menu.buildFromTemplate([
    { label: '工作日志', click: openJournalWorkspace },
    { id: 'journal-state', label: '活动记录：未开启', enabled: false },
    { id: 'journal-pause', label: '暂停活动记录', click: toggleJournalPause, enabled: false },
    {
      label: '打开聊天',
      click: openChatPanel
    },
    {
      label: '助手消息',
      click: openMessages
    },
    {
      label: '显示桌面宠物',
      type: 'checkbox',
      checked: true,
      click: (item) => {
        mainWindow.webContents.send('set-pet-visible', item.checked)
      }
    },
    { type: 'separator' },
    {
      label: '设置',
      click: () => {
        mainWindow.show()
        mainWindow.setIgnoreMouseEvents(false)
        mainWindow.webContents.send('open-settings')
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.quit()
      }
    }
  ])
  petVisibilityItem = contextMenu.items.find((item) => item.type === 'checkbox') || null
  ipcMain.removeAllListeners('pet-visibility-changed')
  ipcMain.on('pet-visibility-changed', (_event, visible: boolean) => {
    if (typeof visible === 'boolean') setTrayPetVisible(visible)
  })

  tray.setToolTip('ChouYu')
  tray.setContextMenu(contextMenu)
  const updateJournalStatus = () => {
    const status = getJournalStatus()
    if (!status || !tray || tray.isDestroyed()) return
    const text = status.state === 'error' ? '记录异常' : !status.config.enabled ? '未开启' : status.config.paused ? '已暂停' : status.state === 'locked' ? '锁屏暂停' : status.state === 'idle' ? '空闲暂停' : status.state === 'excluded' ? '当前应用不记录' : status.state === 'starting' ? '启动中' : '正在记录'
    const scope = !status.config.enabled ? '' : status.captureError ? ' · 画面异常' : status.config.captureEnabled ? ' · 活动＋画面＋OCR' : ' · 仅标题'
    contextMenu.getMenuItemById('journal-state')!.label = `活动记录：${text}${scope}`
    const pause = contextMenu.getMenuItemById('journal-pause')!
    pause.enabled = status.config.enabled
    pause.label = status.config.paused ? '继续活动记录' : '暂停活动记录'
    const unreadSuffix = trayUnreadCount > 0 ? ` · ${trayUnreadCount} 条新消息` : ''
    tray.setToolTip(`ChouYu · 活动记录${text}${scope}${unreadSuffix}`)
  }
  const setTrayUnread = (count: number) => {
    const next = Math.max(0, Math.floor(count) || 0)
    trayUnreadCount = next
    if (!tray || tray.isDestroyed()) return
    if (next > 0) flasher.start()
    else flasher.stop()
    updateJournalStatus()
  }
  ipcMain.removeAllListeners('proactive-unread-changed')
  ipcMain.on('proactive-unread-changed', (_event, count: number) => {
    if (typeof count === 'number') setTrayUnread(count)
  })
  updateJournalStatus()
  const journalTimer = setInterval(updateJournalStatus, 3000)
  app.once('will-quit', () => {
    clearInterval(journalTimer)
    flasher.dispose()
  })
  const onTrayClick = () => {
    if (trayUnreadCount > 0) openMessages()
    else openChatPanel()
  }
  tray.on('click', onTrayClick)
  tray.on('double-click', onTrayClick)
}
```

注意保留文件中原有的 `setTrayPetVisible` 导出函数不动。

- [ ] **Step 3: typecheck 验证**

```bash
npm run typecheck
```

Expected: 通过,无错误。

- [ ] **Step 4: Commit**

```bash
git add src/main/tray.ts
git commit -m "feat(tray): flash tray icon on unread proactive messages with click routing"
```

---

### Task 4: preload 桥 + 类型声明

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/shared/types.ts`

- [ ] **Step 1: preload 增加 API**

在 `src/preload/index.ts` 的 `notifyPetVisible` 定义(约 229-231 行)之后追加:

```ts
  setProactiveUnread: (count: number) => {
    ipcRenderer.send('proactive-unread-changed', count)
  },
  onOpenMessages: (callback: () => void) => {
    ipcRenderer.on('open-messages-center', callback)
    return () => {
      ipcRenderer.removeListener('open-messages-center', callback)
    }
  },
```

- [ ] **Step 2: 类型声明**

在 `src/renderer/src/shared/types.ts` 的 `notifyPetVisible: (visible: boolean) => void`(约 145 行)之后追加:

```ts
  setProactiveUnread: (count: number) => void
  onOpenMessages: (callback: () => void) => () => void
```

- [ ] **Step 3: typecheck 验证**

```bash
npm run typecheck
```

Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/renderer/src/shared/types.ts
git commit -m "feat(preload): bridge proactive unread count and open-messages channel"
```

---

### Task 5: App.tsx 推送未读数 + 托盘打开消息中心

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: 增加两个 effect**

在 `persistProactiveMessages` 的 `useCallback` 定义(约 167-171 行)之后、自动消失气泡 effect 之前插入:

```ts
  // Push unread count to main process for tray flashing
  useEffect(() => {
    window.electronAPI.setProactiveUnread(proactiveMessages.filter(message => !message.readAt).length)
  }, [proactiveMessages])

  useEffect(() => window.electronAPI.onOpenMessages(() => {
    proactiveEngine.markAllRead()
    persistProactiveMessages()
    setShowProactiveCenter(true)
  }), [persistProactiveMessages])
```

- [ ] **Step 2: Pet 传 hasUnread**

在 `<Pet` 渲染处(约 525-540 行)追加 prop:

```tsx
          hasUnread={proactiveMessages.some(message => !message.readAt)}
```

加在 `onFileDropError={setFileDropError}` 之后、`/>` 之前。

- [ ] **Step 3: typecheck 验证**

```bash
npm run typecheck
```

Expected: 报 Pet 组件缺少 `hasUnread` prop 的错误(Task 6 会修复;若 typecheck 因 Task 6 未做而失败,可接受——但更稳妥的顺序是本 task 与 Task 6 合并验证。执行者选择:先做 Task 6 Step 1-2 再回来跑 typecheck 亦可,保持两次 commit 分开)。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat(renderer): push proactive unread count and handle tray open-messages"
```

---

### Task 6: 宠物未读红点

**Files:**
- Modify: `src/renderer/src/components/Pet/Pet.tsx`
- Modify: `src/renderer/src/components/Pet/Pet.css`

- [ ] **Step 1: Pet.tsx 加 prop 与渲染**

`PetProps` 接口 `size: number` 之后追加一行:

```ts
  hasUnread: boolean
```

函数签名解构改为:

```ts
export default function Pet({ position, onPositionChange, onClick, onOpenSettings, onOpenMessages, state, size, hasUnread, onFileDrop, onFileDropError }: PetProps) {
```

容器 div 内 `<PetSvg state={state} />` 之后追加:

```tsx
        {hasUnread && <span className="pet-unread-dot" aria-hidden="true" />}
```

- [ ] **Step 2: Pet.css 加样式**

文件末尾追加:

```css
.pet-unread-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ff4d4f;
  border: 1.5px solid #fff;
  pointer-events: none;
}
```

- [ ] **Step 3: typecheck + 单测**

```bash
npm run typecheck
npm run test
```

Expected: typecheck 通过;vitest 全部通过(含 Task 2 的 tray-flasher 测试)。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/Pet/Pet.tsx src/renderer/src/components/Pet/Pet.css
git commit -m "feat(pet): show unread red-dot badge on the pet"
```

---

### Task 7: 整体验证 + 重建 out/

**Files:**
- Modify: 无源码,产物 `out/`

- [ ] **Step 1: 全量单测 + 类型**

```bash
npm run test
npm run typecheck
```

Expected: 全部通过。

- [ ] **Step 2: 构建并按惯例做字符串字面量进包验证**

```bash
npm run build
grep -rl "proactive-unread-changed" out/preload/assets out/main | head -3
grep -rl "open-messages-center" out/preload/assets out/main | head -3
grep -rl "pet-unread-dot" out/renderer/assets | head -3
grep -rl "助手消息" out/main/*.js 2>/dev/null || grep -rl "助手消息" out/main | head -3
```

Expected: 每条 grep 都有文件命中(用户测试走 out/ 产物,必须确认进包)。

- [ ] **Step 3: 手动验收清单(交用户执行)**

1. 关闭应用后删除 `%APPDATA%\chouyu\Local Storage` 整个目录(重置 greetingDate)并启动 out/ 产物
2. 3 秒后问候气泡出现 → 托盘图标开始 600ms 闪动、宠物右上角出现红点
3. 单击闪烁的托盘 → 消息中心弹出、消息全部标读、闪烁停止、红点消失
4. 右键托盘 → "助手消息"可打开消息中心
5. 无未读时单击托盘 → 仍打开聊天面板(不回归)
6. 悬停托盘 → tooltip 显示 `N 条新消息`

- [ ] **Step 4: 汇报**

向用户汇报完成状态与验收清单,等待手验结论后再谈合并(用户流程:手验通过才合 master)。
