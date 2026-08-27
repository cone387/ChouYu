# ChouYu 工具系统

`0.9.0` 起，AI 可以通过统一协议请求 Main Process 工具。工具定义位于 `src/main/tools/registry.ts`，Provider 适配、授权和执行结果由框架统一处理。

## 风险等级

- `safe`：不读取用户数据、不修改状态，可以自动执行，例如获取当前时间。
- `read`：读取剪贴板、文件、窗口标题等本机信息，必须逐次确认。
- `write`：修改剪贴板或其他本机/外部状态，必须逐次确认。

授权只对当前调用有效。超时、取消或拒绝都会作为工具结果返回给模型。

## 注册工具

```ts
import { registerTool } from './registry'

registerTool({
  name: 'example_tool',
  displayName: '示例工具',
  description: '向模型说明什么时候应该使用这个工具。',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: '示例文本', maxLength: 1000 }
    },
    required: ['text'],
    additionalProperties: false
  },
  risk: 'read',
  requiresConfirmation: true,
  async execute(arguments_, context) {
    return {
      content: `返回给模型的完整结果：${arguments_.text}`,
      summary: '显示在工具时间线中的简短结果'
    }
  }
})
```

普通插件会自动注册为 `plugin_<插件 ID>` 工具。插件工具一律视为外部写操作，并强制逐次确认；插件认证、输入校验和结果包装仍由插件框架负责。

## 约束

- 工具名只能使用小写字母、数字和下划线。
- 不要信任模型提供的路径、URL 或命令；文件应通过系统选择器选择。
- `content` 会截断到 50,000 字符后返回模型。
- `summary` 会截断到 500 字符后显示在界面。
- 涉及外部发布、账号、凭据、文件读取或状态修改的工具必须开启确认。
- 单次回答最多允许四轮工具调用，避免失控循环。
