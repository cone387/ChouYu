# 问题追踪

## Issue #1: 边缘吸附不生效
- **类型**: Bug
- **描述**: 拖拽角色到屏幕边缘时没有自动吸附效果
- **原因分析**: Pet.tsx 中的吸附逻辑在 mouseup 时计算，但使用的是 `e.clientX - dragOffset` 来算最终位置。由于窗口是全屏透明覆盖，坐标应该是正确的。问题可能在于吸附检测用的是 `window.innerWidth`（屏幕工作区宽度）但角色已经在边缘了不会再触发 mouseup 事件（鼠标移出窗口）。
- **修复方向**: 确保 mousemove 事件中也实时计算吸附，或在 mouseup 后重新验证位置边界。
- **修复方案**: 提取 `snap()` 函数，在 mousemove 和 mouseup 中都调用。拖拽过程中实时吸附到边缘。
- **状态**: 已修复

---

## Issue #2: 指令菜单不支持键盘导航
- **类型**: 规格遗漏（v1-ui-spec.md 明确要求但未实现）
- **原规格**: "上下键选择，Enter 确认，Esc 关闭菜单"
- **当前状态**: CommandMenu 只支持鼠标点击，不支持键盘上下选择
- **修复方向**: 在 CommandMenu 中添加 selectedIndex 状态，InputArea 监听 ArrowUp/ArrowDown/Enter 并传递给 CommandMenu
- **修复方案**: CommandMenu 接收 `selectedIndex` prop 并高亮选中项。InputArea 维护 `cmdIndex` 状态，ArrowUp/Down 循环选择，Enter 执行选中指令，Esc 关闭菜单。
- **状态**: 已修复

---

## Issue #3: 面板弹出时输入框不自动获取焦点
- **类型**: 规格遗漏（合理的默认行为，之前未明确实现）
- **描述**: 点击角色或按 Alt+Space 弹出面板后，输入框没有自动获得焦点，用户还需要再点一下才能开始输入
- **修复方向**: ChatPanel 打开时（或 InputArea mount 时）自动 focus textarea
- **修复方案**: InputArea 增加 `autoFocus` prop，ChatPanel 传入 `autoFocus`，textarea 使用 HTML autoFocus 属性。
- **状态**: 已修复

---

## Issue #4: 缺少宠物右键菜单 + 托盘设置点击无效
- **类型**: 规格遗漏 + Bug
- **规格要求**: v1-ui-spec.md 第1节："右键角色 → 上下文菜单（设置/退出）" —— 但代码中 Pet 组件没有实现 onContextMenu
- **Bug**: 托盘菜单中"设置"发送 `open-settings` IPC 到 renderer，但 App.tsx 没有监听这个事件
- **修复方向**: 
  1. Pet 组件添加 onContextMenu 事件，弹出原生菜单或自定义 UI 菜单
  2. App.tsx 监听 `onOpenSettings` 事件并打开设置面板
- **修复方案**: 
  1. Pet.tsx 添加自定义右键菜单（CSS 绝对定位弹出菜单，包含"设置"和"退出"选项）
  2. App.tsx 添加 `onOpenSettings` IPC 监听，打开面板并直接显示设置
  3. ChatPanel 增加 `initialShowSettings` prop 支持从外部触发打开设置
- **状态**: 已修复

---

## Issue #5: 默认面板尺寸过大
- **类型**: 需求变更（用户反馈要改 UI 规格）
- **原规格**: 面板固定 400×520px
- **新需求**: 
  - 无消息时面板只显示状态栏 + 输入框 + 工具栏（紧凑模式）
  - 有对话后才展开显示消息区域
  - 面板高度应自适应内容
- **影响文件**: ChatPanel.css, ChatPanel.tsx, MessageArea.tsx
- **修复方案**: ChatPanel.css 改为 `max-height: 520px` 取消固定高度。MessageArea 无消息时返回 null，面板只剩顶栏+输入框（紧凑模式）。
- **状态**: 已修复
- **需更新规格**: 是（已更新）

---

## Issue #6: 输入框和工具栏分离
- **类型**: 需求变更（用户反馈要改 UI 规格）
- **原规格**: 输入框和工具栏是上下分离的两个区域（输入框上面，工具栏在输入框下面单独一行）
- **新需求**: 工具栏应该嵌入输入框内部（类似 ChatGPT/Claude 的输入框样式）
  - 输入区域是一个整体容器
  - 文本输入在上部
  - 附件按钮、模型选择、发送按钮在输入框内部的底部
  - 视觉上是一个统一的圆角框
- **影响文件**: InputArea.tsx, ChatPanel.css
- **修复方案**: InputArea 用 `.input-container` div 包裹 textarea 和 toolbar。CSS 中 `.input-container` 有统一圆角边框，textarea 无边框透明背景，toolbar 在容器内部底部无分隔线。
- **状态**: 已修复
- **需更新规格**: 是（已更新）

---

## Issue #7: 吸附效果无明显视觉反馈
- **类型**: Bug（Issue #1 修复不完全）
- **描述**: 第一次修复在 mousemove 中实时吸附，用户无法感知"吸附"行为（看起来像是位置被限制而非主动吸附）
- **修复方案**: 改为仅在 mouseup（释放鼠标）时检测吸附，命中时添加 CSS transition（0.2s ease-out）让角色有明显的"弹到边缘"动画效果。拖拽过程中自由移动不做吸附。
- **状态**: 已修复

---

## Issue #8: 紧凑面板位置偏移
- **类型**: Bug
- **描述**: 面板改为自适应高度后，`getPanelPosition` 仍使用 PANEL_HEIGHT=520 做边界检测，导致紧凑面板（~160px）在宠物靠近屏幕底部时被推到远离宠物的位置
- **修复方案**: 新增 `PANEL_COMPACT_HEIGHT=160` 常量，定位算法使用紧凑高度做边界计算。同时默认不加载历史消息，每次打开面板都是空白对话。
- **状态**: 已修复

---

## Issue #9: 关闭面板后点击穿透失效
- **类型**: Bug
- **描述**: 点击关闭按钮后，面板组件卸载（unmount），但 `onMouseLeave` 事件没有触发，导致 `setIgnoreMouseEvents(true)` 未被调用，窗口仍然拦截鼠标事件
- **修复方案**: 在 App.tsx 的 `onClose` 回调中，关闭面板后立即显式调用 `window.electronAPI.setIgnoreMouseEvents(true)`
- **状态**: 已修复

---

## Issue #10: 顶栏占据过多空间
- **类型**: 需求变更
- **描述**: 原设计顶栏包含头像(24x24) + 双行信息（名称+状态），占据太多垂直空间，尤其在紧凑模式下不协调
- **修复方案**: 移除头像 SVG，名称和状态改为同一行显示，减少 padding（12px→8px），缩小按钮尺寸（28px→24px）
- **状态**: 已修复

---

## 环境问题记录

### ELECTRON_RUN_AS_NODE 环境变量
- **发现时间**: 项目初始化阶段
- **现象**: electron 启动后 `process.type` 为 undefined，`require('electron')` 返回路径字符串而非模块对象
- **原因**: VSCode Claude Code 扩展运行在 Electron 中，会设置 `ELECTRON_RUN_AS_NODE=1` 环境变量，导致 electron 二进制以纯 Node.js 模式运行
- **解决**: scripts/dev.js 中 `delete env.ELECTRON_RUN_AS_NODE` 后再启动 electron-vite
- **注意**: 生产环境不会有此问题（最终用户直接双击 exe 启动）
