export type IconName = 'eye' | 'eyeOff' | 'grip' | 'task' | 'list' | 'board' | 'filter' | 'sort' | 'fields' | 'group' | 'plus' | 'chevron' | 'more' | 'today' | 'week' | 'clock' | 'unplanned' | 'all' | 'done' | 'inbox' | 'folder' | 'search' | 'edit' | 'archive' | 'trash' | 'collapse' | 'expand'

const paths: Record<IconName, string> = {
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  eyeOff: 'M3 3l18 18M10.5 5.1A11 11 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3 4M6 6.5A21 21 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5-1M9 9a4 4 0 0 0 6 6',
  grip: 'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01',
  collapse: 'M4 4h16v16H4zM9 4v16M16 9l-3 3 3 3',
  expand: 'M4 4h16v16H4zM9 4v16M13 9l3 3-3 3',
  today: 'M5 4h14v16H5zM8 2v4M16 2v4M5 9h14M9 13h2v3H9z',
  week: 'M4 4h16v16H4zM8 2v4M16 2v4M4 9h16M8 13h1M12 13h1M16 13h1M8 17h1M12 17h1',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2',
  unplanned: 'M8 3h8M9 3v3l6 6-6 6v3M15 3v3l-6 6 6 6v3M8 21h8',
  all: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  done: 'M20 11v8H4V4h11M9 10l3 3 8-9',
  inbox: 'M4 4h16l2 11v5H2v-5zM2 15h6l2 3h4l2-3h6',
  folder: 'M3 6h7l2 2h9v12H3z',
  search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14M15 15l6 6',
  edit: 'M14 5l5 5M4 20l5-1L21 7l-5-5L4 14z',
  archive: 'M3 3h18v5H3zM5 8v13h14V8M9 12h6',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
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
  return <svg className="tasks-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} strokeWidth={name === 'more' ? 3.2 : undefined} /></svg>
}
