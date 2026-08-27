import { BrowserWindow, app, clipboard, desktopCapturer, dialog } from 'electron'
import fs from 'fs'
import path from 'path'
import type { AIToolDefinition, ToolJsonSchema } from '../../shared/tools'
import { validateToolArguments } from '../../shared/tools'
import { filterCaptureSources } from '../../shared/capture'

export interface ToolExecutionContext {
  mainWindow: BrowserWindow
}

export interface ToolResult {
  content: string
  summary: string
}

export interface RegisteredTool extends AIToolDefinition {
  execute: (arguments_: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolResult> | ToolResult
}

const emptySchema: ToolJsonSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false
}

const tools: RegisteredTool[] = [
  {
    name: 'get_current_time',
    displayName: '获取当前时间',
    description: '获取当前设备的日期、时间和时区。',
    inputSchema: {
      type: 'object',
      properties: { timeZone: { type: 'string', description: '可选的 IANA 时区，例如 Asia/Shanghai', maxLength: 80 } },
      additionalProperties: false
    },
    risk: 'safe',
    requiresConfirmation: false,
    execute(arguments_) {
      const requestedZone = typeof arguments_.timeZone === 'string' ? arguments_.timeZone.slice(0, 80) : undefined
      let timeZone = requestedZone
      try {
        if (timeZone) new Intl.DateTimeFormat('zh-CN', { timeZone }).format()
      } catch {
        timeZone = undefined
      }
      const now = new Date()
      const resolvedZone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone
      const formatted = new Intl.DateTimeFormat('zh-CN', {
        timeZone: resolvedZone,
        dateStyle: 'full',
        timeStyle: 'long'
      }).format(now)
      return { content: JSON.stringify({ iso: now.toISOString(), timeZone: resolvedZone, formatted }), summary: formatted }
    }
  },
  {
    name: 'read_clipboard',
    displayName: '读取剪贴板',
    description: '读取当前剪贴板中的纯文本内容。',
    inputSchema: emptySchema,
    risk: 'read',
    requiresConfirmation: true,
    execute() {
      const text = clipboard.readText().slice(0, 50_000)
      return { content: text || '（剪贴板中没有文本）', summary: text ? `已读取 ${text.length} 个字符` : '剪贴板中没有文本' }
    }
  },
  {
    name: 'write_clipboard',
    displayName: '写入剪贴板',
    description: '用指定文本替换当前剪贴板内容。',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: '要写入剪贴板的文本', maxLength: 20_000 } },
      required: ['text'],
      additionalProperties: false
    },
    risk: 'write',
    requiresConfirmation: true,
    execute(arguments_) {
      const text = typeof arguments_.text === 'string' ? arguments_.text.slice(0, 20_000) : ''
      if (!text) throw new Error('没有提供要写入的文本。')
      clipboard.writeText(text)
      return { content: '已写入剪贴板。', summary: `已写入 ${text.length} 个字符` }
    }
  },
  {
    name: 'choose_text_file',
    displayName: '选择并读取文本文件',
    description: '打开文件选择器，由用户选择一个文本文件并读取内容。',
    inputSchema: emptySchema,
    risk: 'read',
    requiresConfirmation: true,
    async execute(_arguments, context) {
      const result = await dialog.showOpenDialog(context.mainWindow, {
        title: '选择要交给 ChouYu 的文本文件',
        properties: ['openFile'],
        filters: [
          { name: '文本文件', extensions: ['txt', 'md', 'json', 'csv', 'log', 'ts', 'tsx', 'js', 'jsx', 'py'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })
      if (result.canceled || !result.filePaths[0]) return { content: '用户取消了文件选择。', summary: '已取消选择文件' }
      const filePath = result.filePaths[0]
      const stat = await fs.promises.stat(filePath)
      if (stat.size > 200_000) throw new Error('文本文件不能超过 200 KB。')
      const content = await fs.promises.readFile(filePath, 'utf8')
      return {
        content: `文件名：${path.basename(filePath)}\n\n${content}`,
        summary: `已读取 ${path.basename(filePath)}（${content.length} 个字符）`
      }
    }
  },
  {
    name: 'list_open_windows',
    displayName: '列出打开的窗口',
    description: '读取当前桌面上可捕获的窗口标题，帮助用户选择要分析的应用。',
    inputSchema: emptySchema,
    risk: 'read',
    requiresConfirmation: true,
    async execute() {
      const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } })
      const names = Array.from(new Set(filterCaptureSources(sources, app.getName()).map((source) => source.name.trim()).filter(Boolean))).slice(0, 50)
      return { content: JSON.stringify(names), summary: `找到 ${names.length} 个窗口` }
    }
  }
]

export function registerTool(tool: RegisteredTool): void {
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(tool.name)) throw new Error(`Invalid tool name: ${tool.name}`)
  if (tools.some((candidate) => candidate.name === tool.name)) throw new Error(`Tool already registered: ${tool.name}`)
  tools.push(tool)
}

export function getToolDefinitions(): AIToolDefinition[] {
  return tools.map(({ execute: _execute, ...definition }) => definition)
}

export function getRegisteredTool(name: string): AIToolDefinition | null {
  const tool = tools.find((candidate) => candidate.name === name)
  if (!tool) return null
  const { execute: _execute, ...definition } = tool
  return definition
}

export async function executeRegisteredTool(
  name: string,
  arguments_: Record<string, unknown>,
  mainWindow: BrowserWindow
): Promise<ToolResult> {
  const tool = tools.find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`未知工具：${name}`)
  return tool.execute(validateToolArguments(tool.inputSchema, arguments_), { mainWindow })
}
