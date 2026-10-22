// The result of a scan: up to three guesses as cards, the Catch button for the ones that are sure enough, the question
// before the bird goes into the Dex, and the success screen after it. When several guesses are sure enough (a recording in
// which several birds sing) one more button catches all of them at once, with the one recording shared between them.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useDeviceStatus } from '../app/deviceStatus'
import { ROUTES } from '../app/routes'
import { useSpecies } from '../data/useSpecies'
import { addCatch, addCatches, useCaughtSummary } from '../db'
import type { PendingIdentification } from '../domain/types'
import { classifyScanError } from '../features/scan/errors'
import { ManySuccessView } from '../features/scan/ManySuccessView'
import { NothingSure } from '../features/scan/NothingSure'
import { buildResultView, confirmTextKey, manyTextKey, scanPathFor, type CandidateView } from '../features/scan/resultModel'
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
  /** The birds that were caught: one, or several that were caught together. */
  views: CandidateView[]
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
  // The question for "catch them all" is open.
  const [confirmingAll, setConfirmingAll] = useState(false)
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

  if (outcome) {
    const [only] = outcome.views
    return outcome.views.length === 1 ? <SuccessView view={only} wasNew={only.timesCaught === 0} media={outcome.media} /> : <ManySuccessView views={outcome.views} media={outcome.media} />
  }
  // Nothing to decide about (the page was reloaded, or the result was already dealt with).
  if (!pending) return <Navigate to={ROUTES.scan} replace />

  const leave = (path: string) => {
    leaving.current = true
    navigate(path)
  }
  const retry = () => leave(scanPathFor(pending.method))
  const discard = () => leave(ROUTES.scan)

  // The guesses that are sure enough: "catch them all" takes these, and only when there are at least two.
  const allowedViews = view ? view.candidates.filter((candidate) => candidate.allowed) : []
  const catching: CandidateView[] = confirmingAll ? allowedViews : confirming ? [confirming] : []

  const confirm = async () => {
    if (catching.length === 0 || saving) return
    const chosen = catching
    setSaving(true)
    setSaveError(null)
    try {
      // The name of the place is looked up only now, when the person has confirmed the catch: until then nothing about
      // the position leaves the phone, also not for a result that is discarded.
      const placeName = await resolvePlaceName(pending.location)
      const mediaToSave = pending.media ? { kind: pending.media.kind, blob: pending.media.blob, mime: pending.media.mime, durationS: pending.media.durationS } : undefined
      const catchFor = (bird: CandidateView, id: string | undefined) => ({
        // One id per identification (and bird): a second tap on the button saves nothing new.
        id,
        speciesId: bird.speciesId,
        method: pending.method,
        confidence: bird.confidence,
        caughtAt: pending.createdAt,
        location: pending.location,
        placeName,
      })
      const catchId = getPendingCatchId()
      if (chosen.length === 1) await addCatch(catchFor(chosen[0], catchId), mediaToSave)
      else await addCatches(chosen.map((bird) => catchFor(bird, catchId ? `${catchId}:${bird.speciesId}` : undefined)), mediaToSave)
      const media = pending.media
      // The success screen first: with the identification gone the page would otherwise send the person to the hub.
      setOutcome({ views: chosen, media })
      setConfirming(null)
      setConfirmingAll(false)
      clearPending()
      flash('success')
    } catch (error) {
      setConfirming(null)
      setConfirmingAll(false)
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
              {allowedViews.length >= 2 ? (
                <div className="bd-result-many-bar" data-testid="catch-many">
                  <p>{t('result.many.hint')}</p>
                  <Button fullWidth icon="check" disabled={saving} onClick={() => setConfirmingAll(true)} data-testid="catch-all-button">
                    {t('result.many.button', { count: allowedViews.length })}
                  </Button>
                </div>
              ) : null}
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
            open={(confirming !== null || confirmingAll) && !autoRunning.current}
            title={confirmingAll ? t('result.many.confirmTitle') : t('result.confirmTitle')}
            message={
              confirmingAll ? (
                <div className="bd-result-confirm" data-testid="confirm-many-text">
                  <p>{t('result.many.confirmLead')}</p>
                  <ul className="bd-result-confirm__list">
                    {allowedViews.map((bird) => (
                      <li key={bird.speciesId} data-testid="confirm-many-bird">
                        {bird.name}
                      </li>
                    ))}
                  </ul>
                  <p>{t(manyTextKey(pending.media))}</p>
                </div>
              ) : confirming ? (
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
            confirmLabel={confirmingAll ? t('result.many.confirmButton') : t('result.confirm.button')}
            cancelLabel={t('result.confirm.cancel')}
            busy={saving}
            onConfirm={() => void confirm()}
            onCancel={() => {
              setConfirming(null)
              setConfirmingAll(false)
            }}
          />
        </>
      ) : null}
    </Page>
  )
}
