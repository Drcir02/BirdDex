import { useState } from 'react'
import { ROUTES } from '../../../app/routes'
import { getDb, useLiveQuery } from '../../../db'
import { t } from '../../../i18n'
import { Button, ButtonLink } from '../../../ui/Button'
import { ConfirmDialog } from '../../../ui/ConfirmDialog'
import { LcdPanel } from '../../../ui/LcdPanel'
import { Notice } from '../../../ui/Notice'
import { Page, PageHeader } from '../../../ui/Page'
import { forgetAllThumbnails } from '../thumbnails'
import { clearDemoData, seedDemoData } from './demoData'
import { DEMO_ID_PREFIX } from './demoPlan'
import './demo.css'

type Outcome = { tone: 'success' | 'error'; text: string } | undefined

/**
 * The hidden page at /#/dev/demo. It fills the Dex with 30 pretend catches (small drawn pictures and short generated
 * whistles) so the screens of a full collection can be looked at, and removes exactly those catches again.
 */
export default function DemoDataPage() {
  const count = useLiveQuery(() => getDb().catches.where('id').startsWith(DEMO_ID_PREFIX).count(), [], 0)
  const [working, setWorking] = useState<'add' | 'remove' | undefined>()
  const [progress, setProgress] = useState<{ done: number; total: number } | undefined>()
  const [outcome, setOutcome] = useState<Outcome>()
  const [confirming, setConfirming] = useState(false)

  const add = async () => {
    setWorking('add')
    setOutcome(undefined)
    try {
      await seedDemoData({ onProgress: (done, total) => setProgress({ done, total }) })
      const now = await getDb().catches.where('id').startsWith(DEMO_ID_PREFIX).count()
      setOutcome({ tone: 'success', text: t('dex.demo.added', { count: now }) })
    } catch {
      setOutcome({ tone: 'error', text: t('dex.demo.failed') })
    } finally {
      setWorking(undefined)
      setProgress(undefined)
    }
  }

  const remove = async () => {
    setWorking('remove')
    setOutcome(undefined)
    try {
      await clearDemoData()
      forgetAllThumbnails()
      setOutcome({ tone: 'success', text: t('dex.demo.removed') })
    } catch {
      setOutcome({ tone: 'error', text: t('dex.demo.failed') })
    } finally {
      setWorking(undefined)
      setConfirming(false)
    }
  }

  return (
    <Page className="bd-demo">
      <PageHeader title={t('dex.demo.title')} backTo={ROUTES.dex} />
      <LcdPanel>
        <p>{t('dex.demo.intro')}</p>
        <p className="bd-demo__safe">{t('dex.demo.safe')}</p>
        <p className="bd-demo__count" data-testid="demo-count" role="status">
          {t('dex.demo.status', { count: count.value })}
        </p>
        <div className="bd-demo__actions">
          <Button icon="download" fullWidth busy={working === 'add'} disabled={working !== undefined} onClick={() => void add()} data-testid="demo-add">
            {working === 'add' && progress ? `${t('dex.demo.working')} ${progress.done}/${progress.total}` : t('dex.demo.add')}
          </Button>
          <Button
            icon="trash"
            variant="danger"
            fullWidth
            busy={working === 'remove'}
            disabled={working !== undefined || count.value === 0}
            onClick={() => setConfirming(true)}
            data-testid="demo-remove"
          >
            {t('dex.demo.remove')}
          </Button>
          <ButtonLink to={ROUTES.dex} variant="secondary" icon="dex" fullWidth>
            {t('dex.demo.openDex')}
          </ButtonLink>
        </div>
      </LcdPanel>
      {outcome ? (
        <div data-testid="demo-outcome">
          <Notice tone={outcome.tone}>{outcome.text}</Notice>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirming}
        tone="danger"
        busy={working === 'remove'}
        title={t('dex.demo.removeTitle')}
        message={<p>{t('dex.demo.removeMessage')}</p>}
        confirmLabel={t('dex.deleteDialog.confirm')}
        cancelLabel={t('dex.deleteDialog.cancel')}
        onConfirm={() => void remove()}
        onCancel={() => setConfirming(false)}
      />
    </Page>
  )
}
