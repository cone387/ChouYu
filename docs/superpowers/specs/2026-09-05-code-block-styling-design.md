# 代码块 Mac 窗口风样式改造（2026-09-05）

## 背景与选型

用户反馈代码块样式需要美化。通过本地 mockup 对比了四个方向（A 极简精致 / B Mac 窗口风 / C 常暗编辑器 / D 轻量悬浮），用户选定 **B · Mac 窗口风**：红黄绿圆点标题栏 + 轻阴影卡片，贴合宠物应用的俏皮气质，保持自动换行。

现状问题：12px 字号偏小；`word-break: break-word` + `overflow-wrap: anywhere` 把长 token 从中间硬折断；浅色主题下复制按钮为白色文字（`--code-bg` 是浅色 `#f4f3fa`，几乎看不清）。

## 变更点

**MessageArea.tsx（CodeBlock 组件）**
- header 左侧新增三个圆点 `<span className="code-block-dots" aria-hidden="true"><i /><i /><i /></span>`，纯装饰不可点击。
- 语言名、复制按钮结构不变。

**ChatPanel.css（.code-block 段重写，全部 token 化）**
- 卡片：`border-radius: var(--radius-xl)`（12px）+ `box-shadow: 0 2px 10px rgba(108, 92, 231, 0.10)`；背景沿用 `--code-bg`（亮 `#f4f3fa` / 暗 `#25243a`），边框沿用 `var(--border)`。
- header：圆点（10px，`#ff5f57` / `#febc2e` / `#28c840`，`border-radius: var(--radius-round)`）+ 语言名 + 复制按钮；底色用 `color-mix` 在 `--code-bg` 基础上微调，分隔线 `var(--divider)`。
- 代码字号 12px → `var(--font-md)`（13px），行高 1.6。
- 复制按钮：浅色主题改为紫色系文字（修复白色看不清 bug），hover 提亮。
- 换行策略：保留 `white-space: pre-wrap`；**删除** `word-break: break-word` 与 `overflow-wrap: anywhere`；`overflow-x` 改 `auto`——正常文本按空格换行，超长 token 横向滚动兜底。
- 语法配色变量（`--hljs-*`，styles/index.css 亮暗两套）**不改**：现有紫系与 B 方向配色基本一致。

## 非目标（YAGNI）

行号、语言彩色图标、圆点可点击（关闭/折叠）、代码块折叠展开、抽独立 CodeBlock 组件文件。

## 测试与验收

- `stream-render.test.ts` 新增守卫：dots + `aria-hidden` 存在；CSS 无 `word-break` / `overflow-wrap: anywhere`；`.code-block` 用 `--radius-xl`、代码用 `--font-md`；复制按钮无白色 rgba。
- `DesignTokens.regression.test.ts` 自动强制新 CSS 无裸 px 间距。
- 门禁：typecheck:node/web + vitest 全量 + build；`npm run dev` 肉眼验收亮/暗两主题。
