import type { CSSProperties } from 'react'
import { cx } from '../../ui/logic'
import './group.css'

export interface AvatarProps {
  nickname: string
  color: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

/** A coloured circle with the first letter of the nickname. */
export function Avatar({ nickname, color, size = 'md', className }: AvatarProps) {
  const initial = Array.from(nickname.trim())[0]?.toUpperCase() ?? '?'
  return (
    <span
      className={cx('bd-avatar', `bd-avatar--${size}`, className)}
      style={{ '--avatar': color } as CSSProperties}
      aria-hidden="true"
      data-testid="avatar"
    >
      {initial}
    </span>
  )
}
