/** The colours a member can pick for the avatar (dark enough for white letters). */
export const MEMBER_COLORS = ['#E8590C', '#2F9E44', '#7048E8', '#1971C2', '#C2255C', '#0B7285', '#9C36B5', '#5C7C0B'] as const

export const DEFAULT_MEMBER_COLOR = MEMBER_COLORS[3]

/** A colour to start with: not the same for everybody, but the same for one nickname. */
export function colorFor(seed: string): string {
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  return MEMBER_COLORS[hash % MEMBER_COLORS.length]
}

export const isMemberColor = (value: string): boolean => /^#[0-9a-fA-F]{6}$/.test(value)
