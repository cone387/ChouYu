# 桌宠多主题支持（2026-09-15）

## 背景与选型

当前 UI 全套紫色（`--accent: #6c5ce7` 系），用户希望提供多种预设配色并可切换。经讨论确定：

- **维度**：新配色与现有亮/暗模式正交 —— 主题只换 accent 系颜色，每个配色自带亮、暗两套变量；现有"跟随系统/亮/暗"设置原样保留。
- **范围**：五个经典配色：紫（默认）、粉、蓝、绿、橙。
- **入口**：仅设置页，现有"外观主题"区旁新增配色选择。
- **宠物**：桌宠本体、聊天头像、Logo 的硬编码紫色一并跟随主题。

选型：沿用现有 `data-theme` 机制的同构扩展 —— 根元素新增 `data-palette` 属性 + CSS 变量覆盖块。否决了"TS 主题对象运行时注入内联变量"（样式逻辑离开 CSS，hover/focus/亮暗派生一致性难维护）和"class 方案"（与现有 data 属性不一致）。基础已铺好：颜色集中在 `styles/index.css` 变量，组件普遍用 `var(--accent)`；亮暗切换、config 持久化与广播、设置 UI 均现成。

## 变更点

### styles/index.css

- `:root` 保持 purple 为默认值（旧配置零迁移，JS 加载前不闪错色）。
- 每个配色两组覆盖块：`[data-palette='x']`（亮色）与 `[data-theme='dark'][data-palette='x']`（暗色）。不进 `prefers-color-scheme` 回退块 —— palette 无纯 CSS 信号，属性由 JS 设置后显式块自然接管。
- 跟随配色的变量：`--accent`、`--accent-hover`、`--focus-ring`、`--user-msg-bg`、`--hover-bg`、`--hljs-keyword`，新增 `--accent-glow`（替换 ChatPanel 两处硬编码紫色阴影）。中性色（bg/text/border）、语义色（error/success/warning）与 `--on-accent`（亮色白字/暗色深字，对五个配色均成立）不动，仍由亮暗控制。

| palette | 亮色 accent | 暗色 accent |
|---|---|---|
| purple（默认） | `#6c5ce7`（现值） | `#a69aff`（现值） |
| pink | `#d6336c` 系 | `#f783ac` 系 |
| blue | `#2563eb` 系 | `#7ca9ff` 系 |
| green | `#16a34a` 系 | `#4ade80` 系 |
| orange | `#ea580c` 系 | `#ffa94d` 系 |

派生变量（hover/focus-ring/glow 等）取对应 accent 的明暗变体，具体色值实现时微调。

### 硬编码紫色清理（7 处）

- `PetSvg.tsx:53`、`MessageArea.tsx:212,360`、`Settings.tsx:725`：`fill="#6C5CE7"` → `fill="var(--accent)"`。
- `ChatPanel.css:678,773`：`rgba(108, 92, 231, …)` 阴影 → `var(--accent-glow)`。
- `Pet.css:134` 的 fallback 保留（无害）。
- 行为变化：宠物/头像/Logo 在暗色下从深紫变为亮紫（跟随 `--accent` 暗色值），与整体 accent 一致。

### 配置与 core/theme.ts

- `src/shared/config.ts`：`AppConfig` 新增 `palette: PaletteId`（类型定义放 shared，两进程共用），`DEFAULT_APP_CONFIG` 默认 `'purple'`。已确认向后兼容机制：`normalizeConfig`（`shared/config.ts:138`）在加载（`database.ts:277`）与保存（`database.ts:364`）时以 `{...DEFAULT_APP_CONFIG, ...source}` 兜底，照 `theme` 字段模式（`config.ts:159`）加一行校验即可让旧配置回落 `'purple'`。
- `core/theme.ts`：`apply()` 同时写 `dataset.theme` 与 `dataset.palette`；`onConfigChanged` 广播时两者同步；未知 palette 值回落 purple（不设属性即默认）。

### 设置 UI

设置页现有"外观主题"radio 组旁新增"配色主题"：五个圆形色块单选（填对应 accent 色，选中加描边），保存走现有 config save 流程。

### Journal 窗口

复用同一 `index.html`，`initTheme` 在渲染入口统一生效，无需额外改动；手验覆盖。

## 非目标（YAGNI）

用户自定义颜色、主题色导入导出、宠物右键菜单快捷切换、按时间段自动换色、六色以上扩展、`--accent-soft` 等更多派生变量。

## 测试与验收

- `core/theme.test.ts` 扩展：palette 属性应用、未知值回落 purple、config 变更同步 palette。
- `DesignTokens.regression.test.ts` 现有规则自动覆盖新增 CSS（无裸 px 间距等）。
- 门禁：typecheck:node/web + vitest 全量 + build。
- 手验清单：五配色 × 亮/暗抽查、Journal 独立窗口、宠物/头像/Logo 换色、代码高亮关键字色、旧配置升级（无 palette 字段回落紫）。
