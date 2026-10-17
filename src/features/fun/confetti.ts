// The layout of a catch celebration: where each confetti piece flies. Pure and deterministic (the same rarity always makes the
// same burst), so it can be unit-tested and a screenshot looks the same twice.

import type { Rarity } from '../../domain/types'

export type PieceShape = 'square' | 'bar' | 'diamond' | 'star'

export interface Piece {
  /** Direction in degrees, 0 is straight up. */
  angle: number
  /** How far it flies, in px. */
  distance: number
  /** Size in px. */
  size: number
  /** Seconds before it starts. */
  delay: number
  /** Seconds it flies. */
  duration: number
  /** Turns while flying, in degrees. */
  spin: number
  shape: PieceShape
  /** Index into the palette of the rarity. */
  colour: number
}

export interface CelebrationPlan {
  pieces: Piece[]
  /** Four-point sparkles that twinkle around the picture. */
  sparkles: Array<{ x: number; y: number; size: number; delay: number }>
  /** A ring that expands once (rare and above). */
  ring: boolean
  /** A golden flash and turning rays (legendary only). */
  flash: boolean
  /** The same colours as CSS values. */
  palette: readonly string[]
}

const PIECES: Readonly<Record<Rarity, number>> = { common: 12, uncommon: 18, rare: 26, epic: 36, legendary: 50 }
const SPARKLES: Readonly<Record<Rarity, number>> = { common: 0, uncommon: 2, rare: 4, epic: 6, legendary: 8 }

/** Colours come from the rarity tokens in styles/tokens.css, with companions that stay visible on the pale LCD. */
export const PALETTES: Readonly<Record<Rarity, readonly string[]>> = {
  common: ['var(--rarity-common)', '#4c7a52', '#8db581', '#b3d49d'],
  uncommon: ['var(--rarity-uncommon)', '#f5c400', '#1e7a3a', '#8bd86a'],
  rare: ['var(--rarity-rare)', '#3db9ff', '#173f99', '#7cc7ff'],
  epic: ['var(--rarity-epic)', '#ff6fb5', '#5b2db0', '#d6a8ff'],
  legendary: ['var(--rarity-legendary)', '#ffd23a', '#ff9a3c', '#c67c00', '#fff2a8'],
}

const SHAPES: readonly PieceShape[] = ['square', 'bar', 'diamond', 'star']

/** A small deterministic random generator (mulberry32). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const SEEDS: Readonly<Record<Rarity, number>> = { common: 11, uncommon: 23, rare: 37, epic: 53, legendary: 71 }

/** Plans the burst. A species that is new to the Dex gets about a third more pieces. */
export function planCelebration(rarity: Rarity, isNew = false): CelebrationPlan {
  const random = seededRandom(SEEDS[rarity] + (isNew ? 1000 : 0))
  const palette = PALETTES[rarity]
  const count = Math.round(PIECES[rarity] * (isNew ? 1.35 : 1))

  const pieces: Piece[] = Array.from({ length: count }, (_, index) => {
    // Evenly spread directions with some wobble, so it looks like a burst and not like a clock.
    const angle = (360 / count) * index + (random() - 0.5) * (360 / count) * 0.8
    const far = index % 2 === 0
    return {
      angle: Math.round(angle * 10) / 10,
      distance: Math.round((far ? 92 : 62) + random() * (far ? 50 : 30)),
      size: Math.round(7 + random() * 6),
      delay: Math.round(random() * 140) / 1000,
      duration: Math.round(900 + random() * 700) / 1000,
      spin: Math.round((random() - 0.5) * 720),
      shape: SHAPES[Math.floor(random() * SHAPES.length)],
      colour: Math.floor(random() * palette.length),
    }
  })

  const sparkleCount = SPARKLES[rarity] + (isNew ? 2 : 0)
  const sparkles = Array.from({ length: sparkleCount }, (_, index) => {
    const angle = ((360 / Math.max(1, sparkleCount)) * index + random() * 30) * (Math.PI / 180)
    const radius = 70 + random() * 30
    return {
      x: Math.round(Math.sin(angle) * radius),
      y: Math.round(-Math.cos(angle) * radius),
      size: Math.round(16 + random() * 12),
      delay: Math.round(random() * 600) / 1000,
    }
  })

  return { pieces, sparkles, ring: rarity === 'rare' || rarity === 'epic' || rarity === 'legendary', flash: rarity === 'legendary', palette }
}
