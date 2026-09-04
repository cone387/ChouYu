/**
 * Settings field-level search index.
 *
 * Each entry maps a user-facing setting to its nav pane (`nav`), the pane
 * label (`navLabel`), and an optional DOM anchor (`fieldId`) used to scroll
 * to and flash the exact control after navigation. `keywords` carry synonyms
 * so queries like “自启” or “快捷键” hit fields whose visible label differs.
 */
export interface SettingsSearchEntry {
  nav: string
  navLabel: string
  label: string
  keywords: string[]
  fieldId?: string
}

export const SETTINGS_SEARCH_INDEX: SettingsSearchEntry[] = [
  // AI 提供者
  { nav: 'ai', navLabel: 'AI 提供者', label: '服务类型', keywords: ['provider', 'openai', 'claude'], fieldId: 'settings-provider' },
  { nav: 'ai', navLabel: 'AI 提供者', label: 'Base URL', keywords: ['接口地址', 'api 地址', 'endpoint'], fieldId: 'settings-base-url' },
  { nav: 'ai', navLabel: 'AI 提供者', label: 'API Key', keywords: ['密钥', '凭据', 'token'], fieldId: 'settings-api-key' },
  { nav: 'ai', navLabel: 'AI 提供者', label: '默认模型', keywords: ['model', '模型选择', '测试连接'], fieldId: 'settings-model' },
  // AI 工具
  { nav: 'tools', navLabel: 'AI 工具', label: 'AI 工具调用', keywords: ['工具开关', 'tool'] },
  { nav: 'tools', navLabel: 'AI 工具', label: '工具授权模式', keywords: ['权限', '逐次确认', '自动授权'] },
  // 记忆中心
  { nav: 'memory', navLabel: '记忆中心', label: '记忆总开关', keywords: ['长期记忆', 'memory'] },
  { nav: 'memory', navLabel: '记忆中心', label: '记忆引擎', keywords: ['mem0', 'sqlite', '远程同步'] },
  { nav: 'memory', navLabel: '记忆中心', label: '向量检索', keywords: ['embedding', '语义搜索', '嵌入'] },
  { nav: 'memory', navLabel: '记忆中心', label: '记忆生命周期', keywords: ['容量上限', 'ttl', '过期', '清理'] },
  { nav: 'memory', navLabel: '记忆中心', label: '主题聚类', keywords: ['cluster', '摘要压缩', '合并'] },
  // 能力中心
  { nav: 'capabilities', navLabel: '能力中心', label: '截图与 OCR', keywords: ['截屏', '识图', '翻译', '总结'] },
  // 角色人格
  { nav: 'persona', navLabel: '角色人格', label: 'SOUL.md 人格设定', keywords: ['性格', '语气', 'prompt', '提示词'], fieldId: 'settings-soul' },
  // 通用
  { nav: 'general', navLabel: '通用', label: '显示桌面悬浮宠物', keywords: ['隐藏宠物', '悬浮窗'], fieldId: 'settings-pet-visible' },
  { nav: 'general', navLabel: '通用', label: '开机自启', keywords: ['自动启动', '登录启动', 'autostart'], fieldId: 'settings-autostart' },
  { nav: 'general', navLabel: '通用', label: '宠物大小', keywords: ['尺寸', '缩放'], fieldId: 'settings-pet-size' },
  { nav: 'general', navLabel: '通用', label: '外观主题', keywords: ['深色', '浅色', '暗夜', 'dark', 'light', '亮暗'], fieldId: 'settings-theme-label' },
  { nav: 'general', navLabel: '通用', label: '唤出面板', keywords: ['快捷键', 'hotkey', '呼出'], fieldId: 'settings-hotkey' },
  { nav: 'general', navLabel: '通用', label: '开机问好', keywords: ['问候', '主动打招呼'] },
  { nav: 'general', navLabel: '通用', label: '久坐提醒', keywords: ['休息提醒', '健康'] },
  { nav: 'general', navLabel: '通用', label: '剪贴板感知', keywords: ['复制', 'clipboard'] },
  // 关于
  { nav: 'about', navLabel: '关于', label: '检查更新', keywords: ['版本', '升级', 'update'] }
]

export function searchSettings(query: string, index: SettingsSearchEntry[] = SETTINGS_SEARCH_INDEX): SettingsSearchEntry[] {
  const q = query.trim().toLocaleLowerCase()
  if (!q) return []
  return index.filter((entry) =>
    entry.label.toLocaleLowerCase().includes(q)
    || entry.navLabel.toLocaleLowerCase().includes(q)
    || entry.keywords.some((keyword) => keyword.toLocaleLowerCase().includes(q))
  )
}
