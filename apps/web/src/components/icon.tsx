const paths = {
  bird: null,
  alert: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v6M12 16.5v.5',
  down: 'M6 9l6 6 6-6',
  home: 'M4 11l8-7 8 7v9H4z',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1',
  out: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
  pen: 'M4 20l1-4L16 5l3 3L8 19z',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  back: 'M15 5l-7 7 7 7',
  next: 'M9 5l7 7-7 7',
  cal: 'M7 5h10a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3zM4 10h16M9 3v4M15 3v4',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  mic: 'M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  list: 'M5 7h14M5 12h14M5 17h9',
  x: 'M6 6l12 12M18 6L6 18',
  search: 'M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM20 20l-4-4',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  pause: 'M9 5v14M15 5v14',
  file: 'M6 3h8l5 5v13H6zM14 3v5h5',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.5',
  retry: 'M4 12a8 8 0 1 0 3-6.2M4 4v5h5',
  play: 'M8 5v14l11-7z',
  stop: 'M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
  cloud: 'M7 18.5h10.5a4 4 0 0 0 .4-7.98A6 6 0 0 0 6.4 9.2 4.7 4.7 0 0 0 7 18.5z',
  chip: 'M9 7h6a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
  key: 'M8 11a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM11 12l9-9M16 7l3 3M14 9l2 2',
  more: 'M5 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM12 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM19 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z',
} as const

const filled: IconName[] = ['play', 'stop', 'more']

export type IconName = keyof typeof paths

export function Icon({ name }: { name: IconName }) {
  if (name === 'bird') {
    return (
      <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M3 15c4 1 8-1 10-5 1-2 3-3 6-2-1 1-1 2-1 3 0 5-4 9-9 9-3 0-5-2-6-5z"
          fill="currentColor"
          stroke="none"
        />
        <circle cx="17" cy="10" r="1" fill="var(--bg)" stroke="none" />
      </svg>
    )
  }
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      {filled.includes(name) ? (
        <path d={paths[name]} fill="currentColor" stroke="none" />
      ) : (
        <path d={paths[name]} />
      )}
    </svg>
  )
}

export function Brand() {
  return (
    <div className="brand">
      <Icon name="bird" />
      Nightjar
    </div>
  )
}
