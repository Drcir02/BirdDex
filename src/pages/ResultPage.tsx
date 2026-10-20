// The result of a scan: up to three guesses as cards, the Catch button for the ones that are sure enough, the question
// before the bird goes into the Dex, and the success screen after it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useDeviceStatus } from '../app/deviceStatus'
import { ROUTES } from '../app/routes'
import { useSpecies } from '../data/useSpecies'
import { addCatch, useCaughtSummary } from '../db'
import type { PendingIdentification } from '../domain/types'
import { classifyScanError } from '../features/scan/errors'
import { NothingSure } from '../features/scan/NothingSure'
import { buildResultView, confirmTextKey, scanPathFor, type CandidateView } from '../features/scan/resultModel'
import { ResultCard } from '../features/scan/ResultCard'
import { ResultMeta } from '../features/scan/ResultMeta'
import { SuccessView } from '../features/scan/SuccessView'
import { resolvePlaceName } from '../features/scan/placeName'
import { useScrollIntoViewWhen } from '../features/scan/useScroll'
import '../features/scan/scan.css'
import '../features/scan/result.css'
import { t } from '../i18n'
import { clearPending, getPendingCatchId, usePending } from '../state/pending'
import { useSettings } from '../state/settings'
import { Button, ConfirmDialog, Notice, Page, PageHeader, Spinner } from '../ui'

interface Outcome {
  view: CandidateView
  wasNew: boolean
  media: PendingIdentification['media']
}

export default function ResultPage() {
  const pending = usePending()
  const navigate = useNavigate()
  const { flash } = useDeviceStatus()
  const { species, error: speciesError, retry: retrySpecies } = useSpecies()
  const { settings } = useSettings()
  const summary = useCaughtSummary()

  const [confirming, setConfirming] = useState<CandidateView | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Set once the catch is saved. The pending identification is cleared then, so the success screen needs its own copy.
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  // The person is leaving on purpose (retry, discard). The result is dropped when this screen goes away, not before, so the
  // screen keeps showing it until the next one is there (the next screen may still be loading) and is never blank.
  const leaving = useRef(false)
  useEffect(
    () => () => {
      if (leaving.current) clearPending()
    },
    [],
  )

  // The question was asked far down the screen, the message is at the top: bring it into view, or nothing seems to happen.
  const saveErrorBox = useRef<HTMLDivElement>(null)
  useScrollIntoViewWhen(saveErrorBox, saveError !== null)

  // A catch the live camera made by itself (it was sure enough) is saved at once, without the question: the bird may be gone
  // in a moment. It can be deleted on the species page.
  const autoRunning = useRef(false)
  const confirmRef = useRef<() => Promise<void>>(async () => undefined)

  const caughtCounts = useMemo(() => new Map(Array.from(summary.bySpecies, ([id, entry]) => [id, entry.count] as const)), [summary.bySpecies])
  const view = useMemo(
    () => (pending && species ? buildResultView({ pending, species, sensitivity: settings.sensitivity, caughtCounts }) : undefined),
    [pending, species, settings.sensitivity, caughtCounts],
  )

  useEffect(() => {
    if (autoRunning.current || !pending?.autoCatch || !view || outcome) return
    const top = view.candidates.find((candidate) => candidate.allowed)
    if (!top) return
    autoRunning.current = true
    setConfirming(top)
  }, [pending, view, outcome])
  useEffect(() => {
    if (autoRunning.current && confirming) void confirmRef.current().finally(() => (autoRunning.current = false))
  }, [confirming])

  if (outcome) return <SuccessView view={outcome.view} wasNew={outcome.wasNew} media={outcome.media} />
  // Nothing to decide about (the page was reloaded, or the result was already dealt with).
  if (!pending) return <Navigate to={ROUTES.scan} replace />

  const leave = (path: string) => {
    leaving.current = true
    navigate(path)
  }
  const retry = () => leave(scanPathFor(pending.method))
  const discard = () => leave(ROUTES.scan)

  const confirm = async () => {
    if (!confirming || saving) return
    const chosen = confirming
    setSaving(true)
    setSaveError(null)
    try {
      // The name of the place is looked up only now, when the person has confirmed the catch: until then nothing about
      // the position leaves the phone, also not for a result that is discarded.
      const placeName = await resolvePlaceName(pending.location)
      await addCatch(
        {
          // One id per identification: a second tap on the button saves nothing new.
          id: getPendingCatchId(),
          speciesId: chosen.speciesId,
          method: pending.method,
          confidence: chosen.confidence,
          caughtAt: pending.createdAt,
          location: pending.location,
          placeName,
        },
        pending.media ? { kind: pending.media.kind, blob: pending.media.blob, mime: pending.media.mime, durationS: pending.media.durationS } : undefined,
      )
      const media = pending.media
      // The success screen first: with the identification gone the page would otherwise send the person to the hub.
      setOutcome({ view: chosen, wasNew: chosen.timesCaught === 0, media })
      setConfirming(null)
      clearPending()
      flash('success')
    } catch (error) {
      setConfirming(null)
      const kind = classifyScanError(error)
      setSaveError(kind === 'storageFull' ? t('common.errors.storageFull') : t('result.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  confirmRef.current = confirm

  return (
    <Page className="bd-result">
      <PageHeader title={t('result.title')} backTo={ROUTES.scan} />

      {speciesError ? (
        <Notice
          tone="error"
          title={t('common.errors.title')}
          action={
            <Button icon="refresh" onClick={retrySpecies}>
              {t('common.retry')}
            </Button>
          }
        >
          {t('result.speciesError')}
        </Notice>
      ) : null}

      {!view && !speciesError ? (
        <p className="bd-scan-quiet" role="status">
          <Spinner size="sm" label={null} />
          <span>{t('common.loading')}</span>
        </p>
      ) : null}

      {saveError ? (
        <div ref={saveErrorBox}>
          <Notice tone="error" title={t('common.errors.title')}>
            {saveError}
          </Notice>
        </div>
      ) : null}

      {view ? (
        <>
          {!view.anyAllowed ? <NothingSure method={view.method} empty={view.empty} onRetry={retry} /> : null}

          {view.candidates.length > 0 ? (
            <section aria-labelledby="result-guesses" className="bd-result-guesses">
              <h2 id="result-guesses" className="bd-result-heading">
                {view.anyAllowed ? t('result.topGuesses') : t('result.weakGuesses')}
              </h2>
              {view.candidates.map((candidate) => (
                <ResultCard key={candidate.speciesId} view={candidate} neededConfidence={view.neededConfidence} enabled={!saving} onCatch={setConfirming} />
              ))}
            </section>
          ) : null}

          <ResultMeta createdAt={pending.createdAt} location={pending.location} media={pending.media} />

          <div className="bd-scan-actions">
            <Button variant="secondary" icon="trash" onClick={discard} data-testid="discard">
              {t('result.discard')}
            </Button>
          </div>

          <ConfirmDialog
            open={confirming !== null && !autoRunning.current}
            title={t('result.confirmTitle')}
            message={
              confirming ? (
                <div className="bd-result-confirm" data-testid="confirm-text">
                  <p className="bd-result-confirm__name">{confirming.name}</p>
                  {confirming.scientificName ? <p className="bd-result-card__sci">{confirming.scientificName}</p> : null}
                  {!confirming.allowed ? (
                    <p className="bd-result-confirm__unsure" data-testid="confirm-unsure">
                      {t('result.confirm.unsure')}
                    </p>
                  ) : null}
                  <p>{t(confirmTextKey(pending.media))}</p>
                </div>
              ) : null
            }
            confirmLabel={t('result.confirm.button')}
            cancelLabel={t('result.confirm.cancel')}
            busy={saving}
            onConfirm={() => void confirm()}
            onCancel={() => setConfirming(null)}
          />
        </>
      ) : null}
    </Page>
  )
}
