interface CommandMenuProps {
  filter: string
  onSelect: (cmd: string) => void
  onClose: () => void
}

const COMMANDS = [
  { cmd: '/clear', desc: '清空对话，新话题' },
  { cmd: '/settings', desc: '打开设置' },
  { cmd: '/model', desc: '切换模型' },
  { cmd: '/help', desc: '查看可用指令' }
]

export default function CommandMenu({ filter, onSelect, onClose }: CommandMenuProps) {
  const filtered = COMMANDS.filter((c) =>
    c.cmd.startsWith(filter) || filter === '/'
  )

  if (filtered.length === 0) return null

  return (
    <div className="command-menu">
      {filtered.map((c) => (
        <button
          key={c.cmd}
          className="command-item"
          onClick={() => onSelect(c.cmd)}
        >
          <span className="command-name">{c.cmd}</span>
          <span className="command-desc">{c.desc}</span>
        </button>
      ))}
    </div>
  )
}
