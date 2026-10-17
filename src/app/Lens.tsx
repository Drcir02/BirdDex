import { useId } from 'react'

/**
 * The big glossy blue lens in the top corner of the device. Pure decoration, but it reacts to the device status
 * (the CSS in shell.css reads data-status on the device): ripples while listening, a sweeping arc while thinking,
 * a flash on success and a red tint on errors.
 */
export function Lens() {
  const uid = useId().replace(/:/g, '')
  const housing = `lens-housing-${uid}`
  const glass = `lens-glass-${uid}`
  const shine = `lens-shine-${uid}`
  return (
    <svg className="bd-lens" viewBox="0 0 100 100" aria-hidden="true" focusable="false" data-testid="lens">
      <defs>
        <radialGradient id={housing} cx="40%" cy="30%" r="80%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.6" stopColor="#e6eaf3" />
          <stop offset="1" stopColor="#97a3bb" />
        </radialGradient>
        <radialGradient id={glass} cx="38%" cy="30%" r="85%">
          <stop offset="0" style={{ stopColor: 'var(--lens-blue-hi)' }} />
          <stop offset="0.2" stopColor="#7cc7ff" />
          <stop offset="0.5" style={{ stopColor: 'var(--lens-blue)' }} />
          <stop offset="0.8" stopColor="#0f40b3" />
          <stop offset="1" style={{ stopColor: 'var(--lens-blue-lo)' }} />
        </radialGradient>
        <linearGradient id={shine} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="53" r="46" fill="rgba(0,0,0,0.38)" />
      <circle cx="50" cy="50" r="47" fill="#3a0710" />
      <circle cx="50" cy="50" r="44" fill={`url(#${housing})`} />
      <circle cx="50" cy="50" r="36" fill="#071540" />
      <circle cx="50" cy="50" r="33.5" fill={`url(#${glass})`} />
      <circle className="bd-lens__tint" cx="50" cy="50" r="33.5" />
      <circle className="bd-lens__ripple" cx="50" cy="50" r="30" />
      <circle className="bd-lens__sweep" cx="50" cy="50" r="28" pathLength={100} />
      <ellipse cx="38.5" cy="33" rx="15" ry="8.5" transform="rotate(-36 38.5 33)" fill={`url(#${shine})`} />
      <circle cx="64" cy="66" r="3.4" fill="#fff" opacity="0.4" />
      <circle cx="58" cy="70.5" r="1.5" fill="#fff" opacity="0.3" />
    </svg>
  )
}
