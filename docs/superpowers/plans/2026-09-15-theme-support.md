# 桌宠多主题支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 ChouYu 增加五个预设配色（紫/粉/蓝/绿/橙），与现有亮/暗模式正交，在设置页切换，宠物/头像/Logo 一并换色。

**Architecture:** 根元素新增 `data-palette` 属性（与 `data-theme` 正交）。`:root` 保持紫色默认；每个非默认配色在 `index.css` 写亮色块 `:root[data-palette='x']` 与暗色块 `:root[data-theme='dark'][data-palette='x']`（组合选择器特异性 (0,3,0) 高于纯暗色块 (0,2,0)，级联安全）。配置走现有 `AppConfig` + `normalizeConfig`/`sanitizeConfigPatch` 管道；`core/theme.ts` 的 `apply()` 同时写两个 dataset 属性。

**Tech Stack:** React 18 + TypeScript + electron-vite + 纯 CSS 变量（无 Tailwind）。测试 vitest，沿用 `theme.test.ts` 的源码守卫（readFileSync + 字符串断言）与纯函数单测风格。

**Spec:** `docs/superpowers/specs/2026-09-15-theme-support-design.md`

**对 spec 的一处简化（已论证）:** spec 提出的 `--accent-glow` 变量改为 `color-mix(in srgb, var(--accent) N%, transparent)` 内联派生——效果相同（阴影跟随配色与亮暗）、少 4×2 个变量要维护，且 `.code-block-header` 已有 color-mix 先例。ChatPanel 两处阴影 alpha 不同（0.20/0.10），color-mix 天然表达。

**色值说明:** 下表为起步值，spec 明确"具体色值实现时微调"——手验阶段（Task 6）可整体微调，改动只落在 `index.css` 的 palette 块。

---

### Task 1: shared 配置层 — PaletteId 类型与校验

**Files:**
- Modify: `src/shared/config.ts`（`AppConfig` 接口 L76 附近、`DEFAULT_APP_CONFIG` L109 附近、`normalizeConfig` L159 附近、`sanitizeConfigPatch` L204 附近）
- Test: `src/shared/config.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/shared/config.test.ts` 的 `describe('config', ...)` 内追加（import 行不变，`normalizeConfig`/`sanitizeConfigPatch` 已导入）：

```ts
  it('defaults the palette to purple and accepts only known ids', () => {
    expect(normalizeConfig({}).palette).toBe('purple')
    expect(normalizeConfig({ palette: 'pink' }).palette).toBe('pink')
    expect(normalizeConfig({ palette: 'gold' } as Partial<AppConfig>).palette).toBe('purple')
    expect(sanitizeConfigPatch({ palette: 'blue' })).toEqual({ palette: 'blue' })
    expect(sanitizeConfigPatch({ palette: 'neon' })).toEqual({})
  })
```

注意：`Partial<AppConfig>` 尚无 `palette` 字段，此测试同时会因为属性不存在而编译失败——这正是 TDD 的失败态。`AppConfig` 需要在文件顶部 import（已有 `DEFAULT_APP_CONFIG` 等，补 `AppConfig` 类型即可，若已导入则跳过）。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/shared/config.test.ts`
Expected: FAIL（TS 编译报 `palette` 不在 `AppConfig` / 期望值不匹配）

- [ ] **Step 3: 最小实现**

`src/shared/config.ts` 三处修改：

(a) 接口与类型工具，放在 `export interface AppConfig` 之前：

```ts
export const PALETTE_IDS = ['purple', 'pink', 'blue', 'green', 'orange'] as const
export type PaletteId = (typeof PALETTE_IDS)[number]

export function isPaletteId(value: unknown): value is PaletteId {
  return typeof value === 'string' && (PALETTE_IDS as readonly string[]).includes(value)
}
```

(b) `AppConfig` 接口里 `theme: 'system' | 'light' | 'dark'` 之后加一行：

```ts
  palette: PaletteId
```

`DEFAULT_APP_CONFIG` 里 `theme: 'system',` 之后加：

```ts
  palette: 'purple',
```

(c) `normalizeConfig` 返回对象里 `theme: ...` 行之后加：

```ts
    palette: isPaletteId(source.palette) ? source.palette : 'purple',
```

`sanitizeConfigPatch` 里 `if (input.theme === ...) patch.theme = input.theme` 行之后加：

```ts
  if (isPaletteId(input.palette)) patch.palette = input.palette
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/shared/config.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: 提交**

```bash
git add src/shared/config.ts src/shared/config.test.ts
git commit -m "feat(config): add palette field with purple default and validation"
```

---

### Task 2: core/theme.ts — resolvePalette 纯函数 + apply 双属性

**Files:**
- Modify: `src/renderer/src/core/theme.ts`
- Modify: `src/renderer/src/shared/types.ts:2,8`（补 `PaletteId` 类型再导出）
- Test: `src/renderer/src/core/theme.test.ts`

- [ ] **Step 1: 写失败测试**

`src/renderer/src/core/theme.test.ts` 的 `describe('theme preference', ...)` 内追加：

```ts
  it('resolves the palette with a purple fallback for unknown values', () => {
    expect(resolvePalette('pink')).toBe('pink')
    expect(resolvePalette(undefined)).toBe('purple')
    expect(resolvePalette('gold')).toBe('purple')
  })
```

并把顶部 `import { resolveTheme } from './theme'` 改为 `import { resolvePalette, resolveTheme } from './theme'`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/renderer/src/core/theme.test.ts`
Expected: FAIL（`resolvePalette` 未导出）

- [ ] **Step 3: 最小实现**

(a) `src/renderer/src/shared/types.ts`：L2 改为

```ts
import type { AppConfig, PaletteId } from '../../../shared/config'
```

L8 改为

```ts
export type { AppConfig, PaletteId } from '../../../shared/config'
```

(b) `src/renderer/src/core/theme.ts` 全文改为：

```ts
import type { AppConfig } from '../shared/types'
import { isPaletteId } from '../../../shared/config'

export type ThemePreference = AppConfig['theme']
export type ResolvedTheme = 'light' | 'dark'
export type PalettePreference = AppConfig['palette']

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === 'light' || preference === 'dark') return preference
  return systemPrefersDark ? 'dark' : 'light'
}

export function resolvePalette(value: unknown): PaletteId {
  return isPaletteId(value) ? value : 'purple'
}

/**
 * Applies the configured theme to <html data-theme="..."> and keeps it in
 * sync with both config changes (broadcast as `config:changed`) and OS-level
 * light/dark switches while the preference is `system`.
 *
 * Returns a cleanup function.
 */
export function initTheme(): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  let preference: ThemePreference = 'system'
  let palettePreference: PalettePreference = 'purple'

  const apply = () => {
    document.documentElement.dataset.theme = resolveTheme(preference, media.matches)
    document.documentElement.dataset.palette = resolvePalette(palettePreference)
  }

  const onMediaChange = () => apply()
  const stopConfigSync = window.electronAPI.onConfigChanged((config) => {
    preference = config.theme
    palettePreference = config.palette
    apply()
  })

  void window.electronAPI.db.getConfig().then((config) => {
    preference = config.theme
    palettePreference = config.palette
    apply()
  }).catch(() => {})

  media.addEventListener('change', onMediaChange)
  apply()

  return () => {
    stopConfigSync()
    media.removeEventListener('change', onMediaChange)
  }
}
```

（`PaletteId` 类型由 `isPaletteId` 所在模块提供，需在 import 中带上：`import { isPaletteId, type PaletteId } from '../../../shared/config'`。）

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/renderer/src/core/theme.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/core/theme.ts src/renderer/src/core/theme.test.ts src/renderer/src/shared/types.ts
git commit -m "feat(theme): apply config palette to html data-palette attribute"
```

---

### Task 3: index.css — 四个配色的亮/暗变量块

**Files:**
- Modify: `src/renderer/src/styles/index.css`（L137 `:root[data-theme='dark']` 块结束后、L139 `* {` 之前插入）
- Test: `src/renderer/src/core/theme.test.ts`

- [ ] **Step 1: 写失败测试**

`theme.test.ts` 的 `describe('theme preference', ...)` 内追加（`darkVarBlock` 工具已存在，直接复用）：

```ts
  it('defines light and dark accent overrides for every non-default palette', () => {
    const accentVars = ['--accent:', '--accent-hover:', '--focus-ring:', '--user-msg-bg:', '--hover-bg:', '--hljs-keyword:']
    for (const palette of ['pink', 'blue', 'green', 'orange']) {
      const light = darkVarBlock(stylesheet, `:root[data-palette='${palette}']`)
      const dark = darkVarBlock(stylesheet, `:root[data-theme='dark'][data-palette='${palette}']`)
      expect(light, `${palette} light block`).not.toBe('')
      expect(dark, `${palette} dark block`).not.toBe('')
      for (const token of accentVars) {
        expect(light, `${palette} light ${token}`).toContain(token)
        expect(dark, `${palette} dark ${token}`).toContain(token)
      }
    }
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/renderer/src/core/theme.test.ts`
Expected: FAIL（palette 块不存在，`not.toBe('')` 断言失败）

- [ ] **Step 3: 写 CSS**

在 `index.css` 的 `:root[data-theme='dark'] { ... }` 块（L96-137）之后、`* {`（L139）之前插入：

```css
/*
 * Palette overrides. :root defaults to purple, so only non-default palettes
 * need blocks, covering just the accent-derived variables in light and dark
 * variants. The dark combos below outrank the purple dark blocks above by
 * specificity ((0,3,0) vs (0,2,0)), so source order is safe.
 */
:root[data-palette='pink'] {
  --accent: #d6336c;
  --accent-hover: #b62357;
  --focus-ring: rgba(214, 51, 108, 0.24);
  --user-msg-bg: #fae8ee;
  --hover-bg: rgba(182, 35, 87, 0.06);
  --hljs-keyword: #c2255c;
}

:root[data-theme='dark'][data-palette='pink'] {
  --accent: #f783ac;
  --accent-hover: #faa2c0;
  --focus-ring: rgba(247, 131, 172, 0.35);
  --user-msg-bg: rgba(240, 62, 124, 0.18);
  --hover-bg: rgba(250, 162, 192, 0.08);
  --hljs-keyword: #f783ac;
}

:root[data-palette='blue'] {
  --accent: #2563eb;
  --accent-hover: #1d4ed8;
  --focus-ring: rgba(37, 99, 235, 0.24);
  --user-msg-bg: #e9eefb;
  --hover-bg: rgba(29, 78, 216, 0.06);
  --hljs-keyword: #1e40af;
}

:root[data-theme='dark'][data-palette='blue'] {
  --accent: #7ca9ff;
  --accent-hover: #9dbdff;
  --focus-ring: rgba(124, 169, 255, 0.35);
  --user-msg-bg: rgba(37, 99, 235, 0.24);
  --hover-bg: rgba(157, 189, 255, 0.08);
  --hljs-keyword: #8ab4ff;
}

:root[data-palette='green'] {
  --accent: #16a34a;
  --accent-hover: #15803d;
  --focus-ring: rgba(22, 163, 74, 0.24);
  --user-msg-bg: #e7f6ec;
  --hover-bg: rgba(21, 128, 61, 0.06);
  --hljs-keyword: #166534;
}

:root[data-theme='dark'][data-palette='green'] {
  --accent: #4ade80;
  --accent-hover: #71e09b;
  --focus-ring: rgba(74, 222, 128, 0.35);
  --user-msg-bg: rgba(34, 197, 94, 0.2);
  --hover-bg: rgba(113, 224, 155, 0.08);
  --hljs-keyword: #86efac;
}

:root[data-palette='orange'] {
  --accent: #ea580c;
  --accent-hover: #c2410c;
  --focus-ring: rgba(234, 88, 12, 0.24);
  --user-msg-bg: #fceadd;
  --hover-bg: rgba(194, 65, 12, 0.06);
  --hljs-keyword: #c2410c;
}

:root[data-theme='dark'][data-palette='orange'] {
  --accent: #ffa94d;
  --accent-hover: #ffc078;
  --focus-ring: rgba(255, 169, 77, 0.35);
  --user-msg-bg: rgba(249, 115, 22, 0.2);
  --hover-bg: rgba(255, 192, 120, 0.08);
  --hljs-keyword: #ffa94d;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/renderer/src/core/theme.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/styles/index.css src/renderer/src/core/theme.test.ts
git commit -m "feat(theme): add pink blue green orange palette variable blocks"
```

---

### Task 4: 硬编码紫色清理 — SVG fill 与 ChatPanel 阴影

**Files:**
- Modify: `src/renderer/src/components/Pet/PetSvg.tsx:53`
- Modify: `src/renderer/src/components/ChatPanel/MessageArea.tsx:212,360`
- Modify: `src/renderer/src/components/Settings/Settings.tsx:725`
- Modify: `src/renderer/src/components/ChatPanel/ChatPanel.css:678,773`
- Test: `src/renderer/src/core/theme.test.ts`

- [ ] **Step 1: 写失败测试**

`theme.test.ts` 顶部已读入 `settingsSource`；补两个读入（放在现有 readFileSync 之后）：

```ts
const petSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/Pet/PetSvg.tsx'), 'utf8')
const chatPanelCss = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ChatPanel/ChatPanel.css'), 'utf8')
```

`describe('theme preference', ...)` 内追加：

```ts
  it('replaces hardcoded purple fills with the accent variable', () => {
    expect(petSource).toContain('fill="var(--accent)"')
    expect(petSource).not.toContain('#6C5CE7')
    expect(messageAreaSource).not.toContain('#6C5CE7')
    expect(settingsSource).not.toContain('#6C5CE7')
  })

  it('derives chat shadows from the accent color', () => {
    expect(chatPanelCss).not.toContain('rgba(108, 92, 231')
    expect(chatPanelCss).toContain('color-mix(in srgb, var(--accent) 20%, transparent)')
    expect(chatPanelCss).toContain('color-mix(in srgb, var(--accent) 10%, transparent)')
  })
```

`messageAreaSource` 读入也需补（同上位置）：

```ts
const messageAreaSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ChatPanel/MessageArea.tsx'), 'utf8')
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/renderer/src/core/theme.test.ts`
Expected: FAIL（两用例均含硬编码值）

- [ ] **Step 3: 替换硬编码**

五处 SVG（`PetSvg.tsx:53`、`MessageArea.tsx:212`、`MessageArea.tsx:360`、`Settings.tsx:725`）：

```tsx
<circle cx="40" cy="44" r="28" fill="var(--accent)" />
```

（各处原有自闭合/空白差异保持不变，只改 `fill` 属性值。）

`ChatPanel.css:678`（`.send-btn`）：

```css
  box-shadow: 0 2px 6px color-mix(in srgb, var(--accent) 20%, transparent);
```

`ChatPanel.css:773`（`.code-block`）：

```css
  box-shadow: 0 2px 10px color-mix(in srgb, var(--accent) 10%, transparent);
```

`Pet.css:134` 的 `var(--accent, #6C5CE7)` fallback 保留不动（spec 决定）。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/renderer/src/core/theme.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/components/Pet/PetSvg.tsx src/renderer/src/components/ChatPanel/MessageArea.tsx src/renderer/src/components/Settings/Settings.tsx src/renderer/src/components/ChatPanel/ChatPanel.css src/renderer/src/core/theme.test.ts
git commit -m "refactor(theme): derive pet avatar logo fills and chat shadows from accent"
```

---

### Task 5: 设置页配色选择器

**Files:**
- Modify: `src/renderer/src/components/Settings/Settings.tsx`（外观主题字段 L637 之后插入新字段；组件顶部加 swatch 常量；import 补 `PaletteId`）
- Modify: `src/renderer/src/components/Settings/Settings.css`（`.settings-theme-option.active` 规则 L919-923 之后追加）
- Modify: `src/renderer/src/components/Settings/settings-search-index.ts:41`（外观主题 keywords 扩充）
- Test: `src/renderer/src/core/theme.test.ts`

- [ ] **Step 1: 写失败测试**

`theme.test.ts` 的 `describe('settings field search', ...)` 内追加：

```ts
  it('surfaces the palette picker through settings search', () => {
    expect(searchSettings('配色').some((entry) => entry.fieldId === 'settings-theme-label')).toBe(true)
    expect(settingsSource).toContain('settings-palette-swatch')
    expect(settingsSource).toContain('PALETTE_SWATCHES')
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/renderer/src/core/theme.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

(a) `Settings.tsx`：找到现有的 `AppConfig` 类型 import（来自 `'../../shared/types'`），扩为 `import type { AppConfig, PaletteId } from '../../shared/types'`。组件函数外（import 之后）加常量：

```tsx
const PALETTE_SWATCHES = [
  { id: 'purple', label: '紫色', color: '#6c5ce7' },
  { id: 'pink', label: '粉色', color: '#d6336c' },
  { id: 'blue', label: '蓝色', color: '#2563eb' },
  { id: 'green', label: '绿色', color: '#16a34a' },
  { id: 'orange', label: '橙色', color: '#ea580c' }
] as const satisfies ReadonlyArray<{ id: PaletteId; label: string; color: string }>
```

（swatch 用固定 hex 展示各配色本色，不能跟随 `--accent`，否则全部显示当前主题色。）

(b) `Settings.tsx` L636-637「跟随系统」help 与字段收尾 `</div>` 之后、`settings-field settings-field-row`（唤出面板）之前插入：

```tsx
              <div className="settings-field">
                <label id="settings-palette-label">配色主题</label>
                <div className="settings-palette-options" role="radiogroup" aria-labelledby="settings-palette-label">
                  {PALETTE_SWATCHES.map(({ id, label, color }) => (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={config.palette === id}
                      aria-label={label}
                      className={`settings-palette-swatch${config.palette === id ? ' active' : ''}`}
                      style={{ background: color }}
                      onClick={() => { void save({ palette: id }) }}
                    />
                  ))}
                </div>
                <div className="settings-help">切换界面与宠物的主题色，与亮暗模式自由组合。</div>
              </div>
```

(c) `Settings.css` 在 `.settings-theme-option.active` 规则块之后追加：

```css
.settings-palette-options {
  display: inline-flex;
  gap: var(--space-2);
}

.settings-palette-swatch {
  width: 22px;
  height: 22px;
  border-radius: var(--radius-round);
  border: 2px solid var(--border);
  cursor: pointer;
}

.settings-palette-swatch.active {
  border-color: var(--text-primary);
}
```

（选中描边用 `--text-primary` 而非 `--accent`：swatch 背景即本配色 accent，同色描边会不可见。）

(d) `settings-search-index.ts:41` 的外观主题条目 keywords 扩为：

```ts
keywords: ['深色', '浅色', '暗夜', 'dark', 'light', '亮暗', '配色', '主题色', '换色'],
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/renderer/src/core/theme.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/components/Settings/Settings.tsx src/renderer/src/components/Settings/Settings.css src/renderer/src/components/Settings/settings-search-index.ts src/renderer/src/core/theme.test.ts
git commit -m "feat(settings): add palette swatch picker in appearance section"
```

---

### Task 6: 全量门禁与手验

**Files:** 无代码改动（验证任务）

- [ ] **Step 1: 类型检查**

Run: `npm run typecheck:node && npm run typecheck:web`
Expected: 双双通过，无错误

- [ ] **Step 2: 全量测试**

Run: `npx vitest run`
Expected: 全部 PASS（对照 memory：本机 `test:smoke` 的 runtime-ui 拖拽断言是既有环境问题，不在此门禁内，不因它回滚）

- [ ] **Step 3: 构建**

Run: `npm run build`
Expected: 成功

- [ ] **Step 4: 手验（npm run dev）**

按 spec 手验清单逐项过：

1. 设置 → 通用 → 外观主题旁出现「配色主题」五个色块，默认选中紫色
2. 逐一点击粉/蓝/绿/橙：发送按钮、链接、focus 圈、用户消息气泡底色、hover 底色、宠物本体、聊天头像、关于页 Logo 全部即时换色（无需重启）
3. 每个配色下切深色模式再切浅色：accent 跟随亮暗变体，无残留旧色
4. 跟随系统 + 系统切深色：palette 保持，accent 用暗色变体
5. 代码块语法高亮 keyword 颜色随配色变化，且与 string/title 颜色肉眼可区分（不可区分则微调该配色 `--hljs-keyword` 值后重跑 Step 2）
6. Journal 独立窗口打开：配色与主窗口一致，切换时同步（`config:changed` 广播）
7. 重启应用：配色保持（持久化）
8. 旧配置升级：删除数据文件里 `palette` 字段后启动，回落紫色无报错
9. 搜索框输入「配色」：定位到外观主题字段

- [ ] **Step 5: 若手验中微调了色值**

```bash
git add src/renderer/src/styles/index.css
git commit -m "style(theme): tune palette values after manual review"
```

---

## Self-Review 记录

- **Spec coverage:** 配置层（Task 1）、theme.ts 双属性（Task 2）、CSS 变量块（Task 3）、7 处硬编码清理（Task 4）、设置 UI + 搜索索引（Task 5）、Journal/持久化/旧配置手验（Task 6）——spec 各节均有对应任务。`--on-accent`/中性色不动 = 无任务，符合 spec。
- **占位符扫描:** 无 TBD；所有代码步骤含完整代码。
- **类型一致性:** `PaletteId`/`isPaletteId`/`PALETTE_IDS` 定义（Task 1）与 theme.ts、Settings.tsx、types.ts 再导出（Task 2/5）签名一致；`PALETTE_SWATCHES` 的 `id: PaletteId` 与 `save({ palette: id })` 匹配 `Partial<AppConfig>`。
