# 托盘未读闪动与消息中心入口设计

日期:2026-09-17
状态:已与用户确认

## 背景与问题

主动提醒引擎(proactive.ts)工作正常,每日问候与休息提醒均在触发并持久化,但用户从未感知:

1. 提醒气泡只显示 8 秒,极易错过
2. 消息中心唯一入口藏在宠物右键菜单"助手消息",用户不知道其存在
3. 没有任何常驻的未读提示

本设计解决"未读可感知 + 入口可发现",不改气泡行为。

## 需求(用户确认)

1. 有未读消息时,托盘图标微信式闪动:图标在"正常 ↔ 消失"间交替(经典 QQ/微信样式),约 600ms 周期
2. 闪烁时单击托盘 → 打开助手消息中心并停止闪烁(微信式);无未读时单击维持现状(打开聊天)
3. 常驻入口:托盘右键菜单新增"助手消息"项;宠物有未读时显示小红点
4. 驱动方式:渲染进程事件推送未读数(与 `pet-visibility-changed` 通道模式一致),不做主进程轮询

## 架构

```
proactiveEngine (renderer)
  → App.tsx: proactiveMessages 变化 → useEffect 推送未读数
  → preload.setProactiveUnread(count) ──IPC 'proactive-unread-changed'──→ main tray.ts
                                                                        → TrayFlasher 启停
main tray.ts 单击/菜单 "助手消息"
  → webContents.send('open-messages-center') → preload.onOpenMessages(cb) → App.tsx
  → markAllRead + 打开 ProactiveCenter → 未读数归零 → 推送 0 → 停止闪烁
```

未读定义:`readAt` 为空的消息。打开消息中心即全部标读(现有语义,不引入"已见未读"概念)。snoozed 消息不特殊处理(标读后自然退出未读)。

## 组件设计

### 1. `src/main/tray-flasher.ts`(新文件,纯逻辑)

```ts
export class TrayFlasher {
  constructor(setImage: (img: nativeImage) => void, normalIcon: NativeImage, blankIcon: NativeImage, intervalMs = 600)
  start(): void   // 幂等;已启动则无操作
  stop(): void    // 清定时器并恢复 normalIcon
  get running(): boolean
  dispose(): void // stop 的别名,语义化清理
}
```

- `start` 后每 intervalMs 在 normalIcon/blankIcon 间交替 setImage
- 不 import Electron 类型以外的任何东西,setImage 由调用方注入,可单元测试

### 2. `src/shared/pet-icon.ts`

新增 `TRANSPARENT_ICON_PNG_BASE64`:16×16 全透明 PNG。用于闪烁"熄灭"相位,避免 `nativeImage.createEmpty()` 在 Windows 上 setImage 的兼容问题。

### 3. `src/main/tray.ts` 改动

- 模块状态:`unreadCount`(number)、`flasher: TrayFlasher | null`
- `setupTray` 内:
  - 构造 blankIcon(normalize 16×16),创建 flasher
  - `setTrayUnread(count)`:`count = Math.max(0, count|0)`;先更新模块级 `unreadCount = count`;count>0 → flasher.start() 且 tooltip 追加 ` · ${count} 条新消息`;count===0 → flasher.stop() 且恢复原 tooltip。所有路径带 `tray.isDestroyed()` 保护
  - `ipcMain.on('proactive-unread-changed', (_e, count) => setTrayUnread(count))`
  - 单击/双击处理:unreadCount>0 → `openMessages()`;否则 `openChatPanel()`(现状)
  - `openMessages()`:restore/show/focus/moveTop 窗口(与 openChatPanel 前奏一致)后 `webContents.send('open-messages-center')`
  - 右键菜单"打开聊天"下新增"助手消息"项 → `openMessages()`
  - `will-quit` 时 flasher.dispose()(与 journalTimer 同模式)
- tooltip 基础文案仍由 journal 轮询每 3s 重写;闪动状态合成放在该轮询函数内统一生成(读模块级 unreadCount),避免两处写 tooltip 互相覆盖

### 4. `src/preload/index.ts`

- `setProactiveUnread: (count: number) => ipcRenderer.send('proactive-unread-changed', count)`
- `onOpenMessages: (callback) => ipcRenderer.on('open-messages-center', () => callback())`,返回清理函数,模式与 `onSetPetVisible` 一致

### 5. `src/renderer/src/App.tsx`

- `useEffect([proactiveMessages])`:推送 `messages.filter(m => !m.readAt).length` 到 `window.electronAPI.setProactiveUnread(count)`。该 state 在新消息/标读/删除/水合/清空所有路径都会更新,覆盖完整
- `useEffect` 注册 `onOpenMessages` 回调:`proactiveEngine.markAllRead()` + `persistProactiveMessages()` + `setShowProactiveCenter(true)`(与宠物右键菜单现有行为一致)
- `<Pet hasUnread={proactiveMessages.some(m => !m.readAt)} …>`

### 6. `src/renderer/src/components/Pet/Pet.tsx` + 样式

- 新 prop `hasUnread: boolean`;true 时在宠物容器右上角渲染红点元素
- CSS:8px 圆点、`#ff4d4f`、细白描边、静态无动画

## 不做的事

- 不改 8 秒气泡自动消失行为
- 不加新设置开关(闪动是未读的固有表现)
- 不做任务栏(taskbar)闪烁或系统通知(后续可另立批次)
- 不做 macOS Dock badge

## 测试

1. 单元(`tray-flasher.test.ts`,node 环境,注入 fake setImage):start 后按周期交替调用、幂等、stop 恢复 normalIcon、dispose 清理
2. 冒烟:现有 chat-smoke 框架不扩展(托盘图标闪烁无法从 CDP 断言)
3. 手动验收(用户执行,按功能流程合入前必须):
   - 删 `%APPDATA%\chouyu` 下 `chouyu-data.json` 中 greetingDate 或次日启动 → 3 秒后问候 → 托盘开始闪、宠物出现红点
   - 单击托盘 → 消息中心弹出、全部标读、闪烁停止、红点消失
   - 右键托盘 → "助手消息"可打开中心
   - 无未读时单击托盘 → 打开聊天(不回归)

## 验收标准

- 有未读:托盘 600ms 闪动 + 宠物红点;无未读:两者皆无
- 闪烁时单击托盘开消息中心并停闪;无未读单击开聊天
- 托盘右键菜单任何时候可开消息中心
- 现有 test 与 smoke 基线不回归
