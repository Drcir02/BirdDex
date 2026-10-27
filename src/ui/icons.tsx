import type { ReactNode, SVGProps } from 'react'
import { SONGBIRD_PATH } from './silhouette'

// Inline SVG icons on a 24 x 24 grid: round 2 px strokes, drawn for this app. They take their colour from the text colour.

export type IconName =
  | 'dex'
  | 'scan'
  | 'settings'
  | 'microphone'
  | 'camera'
  | 'photo'
  | 'live'
  | 'check'
  | 'close'
  | 'play'
  | 'pause'
  | 'location'
  | 'calendar'
  | 'bird'
  | 'back'
  | 'search'
  | 'info'
  | 'warning'
  | 'trash'
  | 'download'
  | 'upload'
  | 'refresh'
  | 'speaker'
  | 'chevron'
  | 'people'

const GEAR =
  'M10.1 4.8 L10.5 2.4 L13.5 2.4 L13.9 4.8 L15.8 5.5 L17.7 4.2 L19.8 6.3 L18.5 8.2 L19.2 10.1 L21.6 10.5 L21.6 13.5 L19.2 13.9 L18.5 15.7 L19.8 17.7 L17.7 19.8 L15.8 18.5 L13.9 19.2 L13.5 21.6 L10.5 21.6 L10.1 19.2 L8.3 18.5 L6.3 19.8 L4.2 17.7 L5.5 15.8 L4.8 13.9 L2.4 13.5 L2.4 10.5 L4.8 10.1 L5.5 8.2 L4.2 6.3 L6.3 4.2 L8.2 5.5Z'

const GLYPHS: Record<IconName, ReactNode> = {
  // The handheld itself: body, screen, lens and a button strip
  dex: (
    <>
      <rect x="4.5" y="2.5" width="15" height="19" rx="3" />
      <rect x="7.5" y="5.5" width="9" height="7" rx="1" />
      <circle cx="9" cy="17" r="1.6" />
      <path d="M13.5 16.2h3M13.5 18.6h3" />
    </>
  ),
  // Viewfinder corners with a scan line
  scan: (
    <>
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <path d="M7.5 12h9" />
    </>
  ),
  settings: (
    <>
      <path d={GEAR} />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  microphone: (
    <>
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v4M8.5 21.5h7" />
    </>
  ),
  camera: (
    <>
      <path d="M3 8.5a1 1 0 0 1 1-1h3L8.6 5h6.8L17 7.5h3a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      <circle cx="12" cy="13.4" r="3.8" />
    </>
  ),
  photo: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3.5 17l5-5 4 4 3-3 5 5" />
      <circle cx="16.5" cy="9" r="1.6" />
    </>
  ),
  // A video camera with a recording dot
  live: (
    <>
      <rect x="2.5" y="6" width="13" height="12" rx="2" />
      <path d="M15.5 10.5l6-3.5v10l-6-3.5z" />
      <circle cx="6.6" cy="9.9" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  check: <path d="M4.5 12.5l5 5 10-11" strokeWidth="3" />,
  close: <path d="M5.5 5.5l13 13M18.5 5.5l-13 13" strokeWidth="2.6" />,
  play: <path d="M7 4.5v15l12-7.5z" fill="currentColor" />,
  pause: (
    <>
      <rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" />
      <rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" />
    </>
  ),
  location: (
    <>
      <path d="M12 21.5s-7-6.2-7-11.5a7 7 0 0 1 14 0c0 5.3-7 11.5-7 11.5z" />
      <circle cx="12" cy="10" r="2.6" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
      <path d="M8 14h.01M12 14h.01M16 14h.01M8 17.2h.01M12 17.2h.01" strokeWidth="2.6" />
    </>
  ),
  // The generic songbird, scaled down from its 64 x 64 grid
  bird: <path d={SONGBIRD_PATH} fill="currentColor" stroke="none" transform="scale(0.375)" />,
  back: <path d="M19.5 12h-14M11.5 5.5L5 12l6.5 6.5" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L21 21" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6" />
      <path d="M12 7.6h.01" strokeWidth="2.8" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3.5l9.5 16.5h-19z" />
      <path d="M12 10v5" />
      <path d="M12 17.8h.01" strokeWidth="2.8" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9.5 7V4.5h5V7M6 7l1 13h10l1-13" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  download: <path d="M12 3.5v12M6.5 10.5L12 16l5.5-5.5M4.5 20.5h15" />,
  upload: <path d="M12 16.5v-12M6.5 9.5L12 4l5.5 5.5M4.5 20.5h15" />,
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.5-5.8" />
      <path d="M20.5 3.5v5h-5" />
    </>
  ),
  speaker: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  chevron: <path d="M9 5l7 7-7 7" />,
  // Two people: a head and shoulders in front, a second head and shoulder behind
  people: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.6 2.7-6 6-6s6 2.4 6 6" />
      <path d="M15.5 5.2a3.2 3.2 0 0 1 0 5.6M17.5 14.3c2.2.6 3.5 2.5 3.5 5.7" />
    </>
  ),
}

export const ICON_NAMES = Object.keys(GLYPHS) as IconName[]

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name' | 'children' | 'title'> {
  name: IconName
  /** Pixel size (square). Default 24. */
  size?: number
  /** Accessible name. Leave it out when the icon only decorates a button that already has text. */
  title?: string
}

export function Icon({ name, size = 24, title, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      data-icon={name}
      {...rest}
    >
      {GLYPHS[name]}
    </svg>
  )
}
