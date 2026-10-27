import { useCallback, useEffect, useRef, useState } from 'react'
import { useMediaUrl } from '../../db'
import { t } from '../../i18n'
import { Icon } from '../../ui/icons'
import { Spinner } from '../../ui/Spinner'
import { cx } from '../../ui/logic'
import { envelopeOfWav, ENVELOPE_BARS } from './audioEnvelope'
import { formatClock } from './format'

export interface AudioPlayerProps {
  /** The saved clip (a row of the media table). */
  mediaId?: string
  /** Or the address of a clip that is somewhere else (the clip of a post in the group feed). */
  url?: string
  className?: string
}

// Only one recording plays at a time: starting one stops the one before.
let playing: HTMLAudioElement | null = null

/** The loudness bars of a clip, loaded from its address. Undefined until known, and for files that are not WAV. */
function useEnvelope(url: string | undefined): number[] | undefined {
  const [result, setResult] = useState<{ url: string; bars: number[] | undefined } | undefined>()
  useEffect(() => {
    if (!url) return undefined
    let alive = true
    fetch(url)
      .then((response) => response.arrayBuffer())
      .then((buffer) => {
        if (alive) setResult({ url, bars: envelopeOfWav(new Uint8Array(buffer)) })
      })
      .catch(() => {
        if (alive) setResult({ url, bars: undefined })
      })
    return () => {
      alive = false
    }
  }, [url])
  return result && result.url === url ? result.bars : undefined
}

/**
 * Plays a saved recording: an audio element with our own controls (play and pause, a seek bar laid over the loudness bars,
 * and the time). The bars are the clip's level over time and light up as the clip plays.
 */
export function AudioPlayer({ mediaId, url, className }: AudioPlayerProps) {
  const saved = useMediaUrl(url ? undefined : mediaId)
  const media = url ? { url, loading: false, missing: false, durationS: undefined } : saved
  const audio = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [failed, setFailed] = useState(false)
  const envelope = useEnvelope(media.url)

  const knownDuration = Number.isFinite(duration) && duration > 0 ? duration : (media.durationS ?? 0)

  // While the clip plays the position is read on every frame, which keeps the bars and the seek bar smooth.
  useEffect(() => {
    if (!isPlaying) return undefined
    let frame = 0
    const tick = () => {
      if (audio.current) setCurrent(audio.current.currentTime)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [isPlaying])

  // Leaving the screen stops the sound.
  useEffect(() => {
    const element = audio.current
    return () => {
      element?.pause()
      if (playing === element) playing = null
    }
  }, [media.url])

  const toggle = useCallback(() => {
    const element = audio.current
    if (!element) return
    setFailed(false)
    if (!element.paused) {
      element.pause()
      return
    }
    if (element.ended || (knownDuration > 0 && element.currentTime >= knownDuration - 0.05)) element.currentTime = 0
    if (playing && playing !== element) playing.pause()
    playing = element
    // play() must be called straight from the tap (iOS). It returns a promise that rejects if the sound cannot start.
    const started = element.play()
    if (started) started.catch(() => setFailed(true))
  }, [knownDuration])

  const seek = (seconds: number) => {
    if (audio.current) audio.current.currentTime = seconds
    setCurrent(seconds)
  }

  if (media.loading) {
    return (
      <div className={cx('bd-audio', 'is-quiet', className)} role="status">
        <Spinner size="sm" label={null} />
        <span>{t('dex.audio.loading')}</span>
      </div>
    )
  }
  if (media.missing || !media.url) {
    return <p className={cx('bd-audio', 'is-quiet', className)}>{t('dex.audio.missing')}</p>
  }

  const bars = envelope ?? Array.from({ length: ENVELOPE_BARS }, () => 0.18)
  const fraction = knownDuration > 0 ? Math.min(1, current / knownDuration) : 0
  const lit = Math.round(fraction * bars.length)
  const clock = `${formatClock(current)} / ${formatClock(knownDuration)}`

  return (
    <div className={cx('bd-audio', isPlaying && 'is-playing', className)} role="group" aria-label={t('dex.audio.label')} data-testid="audio-player">
      <audio
        ref={audio}
        src={media.url}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false)
          setCurrent(0)
        }}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onError={() => setFailed(true)}
      />
      <button type="button" className="bd-audio__button" onClick={toggle} aria-label={t(isPlaying ? 'dex.audio.pause' : 'dex.audio.play')} data-testid="audio-toggle">
        <Icon name={isPlaying ? 'pause' : 'play'} size={24} />
      </button>
      <div className="bd-audio__track">
        <div className="bd-audio__bars" role="presentation">
          {bars.map((level, index) => (
            <i key={index} className={cx('bd-audio__bar', index < lit && 'is-lit')} style={{ height: `${Math.round(18 + level * 82)}%` }} />
          ))}
        </div>
        <input
          className="bd-audio__seek"
          type="range"
          min={0}
          max={knownDuration > 0 ? knownDuration : 1}
          step={0.01}
          value={Math.min(current, knownDuration > 0 ? knownDuration : 1)}
          disabled={knownDuration <= 0}
          aria-label={t('dex.audio.position')}
          aria-valuetext={clock}
          onChange={(event) => seek(Number(event.target.value))}
        />
      </div>
      <span className="bd-audio__time" aria-hidden="true">
        {clock}
      </span>
      {failed ? (
        <p className="bd-audio__error" role="alert">
          {t('dex.audio.error')}
        </p>
      ) : null}
    </div>
  )
}
