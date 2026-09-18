type IconName = 'task' | 'list' | 'board' | 'filter' | 'sort' | 'fields' | 'group' | 'plus' | 'chevron' | 'more'

const paths: Record<IconName, string> = {
  task: 'M7 3h8l3 3v6M7 3H5v18h9M8 8h6M8 12h4M13 17l3 3 6-7',
  list: 'M4 4h16v16H4zM9 4v16M4 9h16M4 14h16',
  board: 'M4 4h4v13H4zM10 4h4v9h-4zM16 4h4v16h-4z',
  filter: 'M4 5h16l-6 7v7l-4-2v-5z',
  sort: 'M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3',
  fields: 'M4 4h16v16H4zM8 8h1M12 8h4M8 12h1M12 12h4M8 16h1M12 16h4',
  group: 'M4 6h3M11 6h9M4 12h9M17 12h3M4 18h3M11 18h9M7 4v4M13 10v4M7 16v4',
  plus: 'M12 5v14M5 12h14',
  chevron: 'M6 9l6 6 6-6',
  more: 'M5 12h.01M12 12h.01M19 12h.01'
}

export default function TaskIcon({ name }: { name: IconName }) {
  return <svg className="tasks-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}
