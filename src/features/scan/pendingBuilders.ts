// Builds the PendingIdentification that a scan screen hands to the result screen (src/state/pending.ts).
// One builder per way of identifying. They clean the guesses up first, so the result screen can rely on them:
// at most three, strongest first, each species once, every confidence a number from 0 to 1.

import type { LiveUpdate, PhotoResult, SoundResult } from '../../domain/engines'
import type { Candidate, GeoPoint, PendingIdentification } from '../../domain/types'

export const MAX_CANDIDATES = 3

/** What the engines know about the whole picture besides the guesses; the Catch rules use it (src/domain/thresholds.ts). */
type PictureFacts = Partial<Pick<PhotoResult, 'pBird' | 'outsideDexTop'>>

/** Copies the numbers about the picture that are real numbers onto the pending identification. */
function withPictureFacts(pending: PendingIdentification, facts: PictureFacts): PendingIdentification {
  if (typeof facts.pBird === 'number' && Number.isFinite(facts.pBird)) pending.pBird = facts.pBird
  if (typeof facts.outsideDexTop === 'number' && Number.isFinite(facts.outsideDexTop)) pending.outsideDexTop = facts.outsideDexTop
  return pending
}

/** A guess that would be shown as "0 %" is noise, not a guess: it is left out of the lists. */
export const MIN_SHOWN_CONFIDENCE = 0.005

/** Strongest first, one entry per species (the best one), no broken numbers, nothing below 0,5 %, at most `limit` entries. */
export function normalizeCandidates(candidates: readonly Candidate[] | undefined, limit: number = MAX_CANDIDATES): Candidate[] {
  const best = new Map<string, number>()
  for (const candidate of candidates ?? []) {
    if (!candidate || typeof candidate.speciesId !== 'string' || candidate.speciesId === '') continue
    if (typeof candidate.confidence !== 'number' || !Number.isFinite(candidate.confidence)) continue
    const confidence = Math.min(1, Math.max(0, candidate.confidence))
    if (confidence < MIN_SHOWN_CONFIDENCE) continue
    if (confidence > (best.get(candidate.speciesId) ?? -1)) best.set(candidate.speciesId, confidence)
  }
  return [...best]
    .map(([speciesId, confidence]) => ({ speciesId, confidence }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, Math.max(0, limit))
}

/** Sound: the guesses and, when the engine kept one, the best few seconds as the audio clip to save. */
export function buildSoundPending(result: SoundResult, location: GeoPoint | undefined, now: number = Date.now()): PendingIdentification {
  const pending: PendingIdentification = { method: 'sound', candidates: normalizeCandidates(result.candidates), createdAt: now }
  if (result.clip && result.clip.size > 0) {
    pending.media = {
      kind: 'audio',
      blob: result.clip,
      mime: result.clip.type || 'audio/wav',
      ...(typeof result.clipSeconds === 'number' && Number.isFinite(result.clipSeconds) ? { durationS: result.clipSeconds } : {}),
    }
  }
  if (location) pending.location = location
  return pending
}

/** Photo: the guesses for the picture, and the picture itself (already scaled down and saved as JPEG). */
export function buildPhotoPending(result: Pick<PhotoResult, 'candidates'> & PictureFacts, image: Blob, location: GeoPoint | undefined, now: number = Date.now()): PendingIdentification {
  const pending: PendingIdentification = {
    method: 'photo',
    candidates: normalizeCandidates(result.candidates),
    media: { kind: 'image', blob: image, mime: image.type || 'image/jpeg' },
    createdAt: now,
  }
  if (location) pending.location = location
  return withPictureFacts(pending, result)
}

/** Live camera: what the scanner thought when the person pressed Catch, and the snapshot of that moment. */
export function buildLivePending(update: Pick<LiveUpdate, 'candidates'> & PictureFacts, snapshot: Blob, location: GeoPoint | undefined, now: number = Date.now()): PendingIdentification {
  const pending: PendingIdentification = {
    method: 'live',
    candidates: normalizeCandidates(update.candidates),
    media: { kind: 'image', blob: snapshot, mime: snapshot.type || 'image/jpeg' },
    createdAt: now,
  }
  if (location) pending.location = location
  return withPictureFacts(pending, update)
}
