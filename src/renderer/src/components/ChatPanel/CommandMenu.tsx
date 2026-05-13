interface CommandMenuProps {
  filter: string
  selectedIndex: number
  onSelect: (cmd: string) => void
  onClose: () => void
  pluginCommands?: { cmd: string; desc: string }[]
}

const BUILTIN_COMMANDS = [
  { cmd: '/clear', desc: '清空对话，新话题' },
  { cmd: '/settings', desc: '打开设置' },
  { cmd: '/model', desc: '切换模型' },
  { cmd: '/help', desc: '查看可用指令' }
]

export function getFilteredCommands(filter: string, allCommands: { cmd: string; desc: string }[] = BUILTIN_COMMANDS) {
  return allCommands.filter((c) => c.cmd.startsWith(filter) || filter === '/')
}

export default function CommandMenu({ filter, selectedIndex, onSelect, onClose, pluginCommands }: CommandMenuProps) {
  const allCommands = pluginCommands ? [...BUILTIN_COMMANDS, ...pluginCommands] : BUILTIN_COMMANDS
  const filtered = getFilteredCommands(filter, allCommands)

  if (filtered.length === 0) return null

  return (
    <div className="command-menu">
      {filtered.map((c, i) => (
        <button
          key={c.cmd}
          className={`command-item${i === selectedIndex ? ' selected' : ''}`}
          onClick={() => onSelect(c.cmd)}
        >
          <span className="command-name">{c.cmd}</span>
          <span className="command-desc">{c.desc}</span>
        </button>
      ))}
    </div>
  )
}
