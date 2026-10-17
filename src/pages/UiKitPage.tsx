// The kitchen sink: every shared component in one place. Open it at /#/ui-kit (it is not in the navigation).
import { useState, type ReactNode } from 'react'
import { DEVICE_STATUSES, useDeviceActivity, useDeviceStatus, type DeviceStatus } from '../app/deviceStatus'
import { ROUTES } from '../app/routes'
import { formatPercent, t } from '../i18n'
import { Button } from '../ui/Button'
import { Chip } from '../ui/Chip'
import { ConfidenceBar } from '../ui/ConfidenceBar'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { EmptyState } from '../ui/EmptyState'
import { ICON_NAMES, Icon } from '../ui/icons'
import { IconButton } from '../ui/IconButton'
import { LcdPanel } from '../ui/LcdPanel'
import { LevelMeter } from '../ui/LevelMeter'
import { Notice } from '../ui/Notice'
import { Page, PageHeader } from '../ui/Page'
import { ProgressRing } from '../ui/ProgressRing'
import { SearchField } from '../ui/SearchField'
import { SegmentedControl } from '../ui/SegmentedControl'
import { SILHOUETTE_SHAPES } from '../ui/silhouette'
import { SpeciesSilhouette } from '../ui/SpeciesSilhouette'
import { Spinner } from '../ui/Spinner'
import { Switch } from '../ui/Switch'
import { useToast } from '../ui/Toast'
import './UiKitPage.css'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <LcdPanel title={title} className="bd-kit__section">
      {children}
    </LcdPanel>
  )
}

type FilterId = 'all' | 'czechia' | 'europe'
type Strictness = 'strict' | 'normal' | 'easy'

export default function UiKitPage() {
  const toast = useToast()
  const { flash } = useDeviceStatus()
  const [filter, setFilter] = useState<FilterId>('czechia')
  const [level, setLevel] = useState(0.6)
  const [strictness, setStrictness] = useState<Strictness>('normal')
  const [saveLocation, setSaveLocation] = useState(true)
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState<'confirm' | 'danger' | null>(null)
  const [lights, setLights] = useState<DeviceStatus | null>(null)
  useDeviceActivity(lights)

  const filters: ReadonlyArray<readonly [FilterId, string]> = [
    ['all', t('common.uiKit.chips.filterAll')],
    ['czechia', t('common.uiKit.chips.filterCzechia')],
    ['europe', t('common.uiKit.chips.filterEurope')],
  ]

  return (
    <Page className="bd-kit">
      <PageHeader title={t('common.uiKit.title')} subtitle={t('common.uiKit.intro')} backTo={ROUTES.dex} />

      <Section title={t('common.uiKit.sections.type')}>
        <div className="bd-kit__stack">
          <div>
            <span className="bd-kit__caption">{t('common.uiKit.type.display')}</span>
            <p className="bd-kit__display1">{t('common.uiKit.sampleName')}</p>
            <p className="bd-kit__display2">{t('common.uiKit.pangram')}</p>
          </div>
          <div>
            <span className="bd-kit__caption">{t('common.uiKit.type.lcd')}</span>
            <p className="bd-kit__lcdtext">{t('common.uiKit.pangram')}</p>
            <p className="bd-kit__lcdtext bd-kit__lcdtext--soft">
              {t('common.uiKit.sampleScientific')} · {t('common.uiKit.sampleFamily')}
            </p>
          </div>
          <div>
            <span className="bd-kit__caption">{t('common.uiKit.type.wordmark')}</span>
            <p className="bd-kit__wordmark">BirdDex #042 0123456789</p>
          </div>
        </div>
      </Section>

      <Section title={t('common.uiKit.sections.buttons')}>
        <div className="bd-kit__row">
          <Button>{t('common.uiKit.buttons.primary')}</Button>
          <Button variant="secondary">{t('common.uiKit.buttons.secondary')}</Button>
          <Button variant="danger" icon="trash">
            {t('common.uiKit.buttons.danger')}
          </Button>
          <Button disabled>{t('common.uiKit.buttons.disabled')}</Button>
          <Button busy>{t('common.uiKit.buttons.busy')}</Button>
          <Button icon="scan">{t('common.uiKit.buttons.withIcon')}</Button>
        </div>
        <div className="bd-kit__row">
          <Button size="lg" icon="microphone" fullWidth>
            {t('common.uiKit.buttons.large')}
          </Button>
        </div>
        <div className="bd-kit__row">
          <IconButton icon="back" label={t('common.back')} />
          <IconButton icon="close" label={t('common.close')} />
          <IconButton icon="play" label={t('common.uiKit.icons.play')} variant="ghost" />
          <IconButton icon="pause" label={t('common.uiKit.icons.pause')} variant="ghost" />
        </div>
      </Section>

      <Section title={t('common.uiKit.sections.chips')}>
        <div className="bd-kit__row">
          <Chip>{t('common.uiKit.chips.neutral')}</Chip>
          <Chip tone="info" icon="info">
            {t('common.uiKit.chips.info')}
          </Chip>
          <Chip tone="success" icon="check">
            {t('common.uiKit.chips.success')}
          </Chip>
          <Chip tone="warning" icon="warning">
            {t('common.uiKit.chips.warning')}
          </Chip>
          <Chip tone="danger">{t('common.uiKit.chips.danger')}</Chip>
        </div>
        <div className="bd-kit__row">
          <Chip tone="common">{t('common.rarity.common')}</Chip>
          <Chip tone="uncommon">{t('common.rarity.uncommon')}</Chip>
          <Chip tone="rare">{t('common.rarity.rare')}</Chip>
          <Chip tone="epic">{t('common.rarity.epic')}</Chip>
          <Chip tone="legendary">{t('common.rarity.legendary')}</Chip>
        </div>
        <div className="bd-kit__row">
          {filters.map(([id, label]) => (
            <Chip key={id} selected={filter === id} onClick={() => setFilter(id)}>
              {label}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title={t('common.uiKit.sections.inputs')}>
        <div className="bd-kit__stack">
          <SearchField value={query} onChange={setQuery} label={t('common.uiKit.inputs.searchLabel')} placeholder={t('common.uiKit.inputs.searchPlaceholder')} />
          <SegmentedControl
            label={t('common.uiKit.inputs.segmentedLabel')}
            value={strictness}
            onChange={setStrictness}
            options={[
              { value: 'strict', label: t('common.uiKit.inputs.strict') },
              { value: 'normal', label: t('common.uiKit.inputs.normal') },
              { value: 'easy', label: t('common.uiKit.inputs.easy') },
            ]}
          />
          <Switch checked={saveLocation} onChange={setSaveLocation} label={t('common.uiKit.inputs.switchLabel')} description={t('common.uiKit.inputs.switchHint')} />
        </div>
      </Section>

      <Section title={t('common.uiKit.sections.notices')}>
        <div className="bd-kit__stack">
          <Notice title={t('common.uiKit.notices.infoTitle')}>{t('common.uiKit.notices.infoText')}</Notice>
          <Notice tone="success" title={t('common.uiKit.notices.successTitle')}>
            {t('common.uiKit.notices.successText')}
          </Notice>
          <Notice tone="warning" title={t('common.uiKit.notices.warningTitle')}>
            {t('common.uiKit.notices.warningText')}
          </Notice>
          <Notice tone="error" title={t('common.uiKit.notices.errorTitle')} action={<Button icon="refresh">{t('common.retry')}</Button>}>
            {t('common.uiKit.notices.errorText')}
          </Notice>
        </div>
      </Section>

      <Section title={t('common.uiKit.sections.panels')}>
        <div className="bd-kit__stack">
          <LcdPanel title={t('common.uiKit.panels.screenTitle')} titleLevel={3}>
            <p>{t('common.uiKit.panels.body')}</p>
          </LcdPanel>
          <LcdPanel title={t('common.uiKit.panels.darkTitle')} titleLevel={3} tone="dark">
            <p>{t('common.uiKit.panels.body')}</p>
          </LcdPanel>
        </div>
      </Section>

      <Section title={t('common.uiKit.sections.progress')}>
        <div className="bd-kit__row bd-kit__row--center">
          <ProgressRing value={0.08} label="8 %" size={72} />
          <ProgressRing value={0.35} label={t('common.uiKit.progress.ringLabel', { count: 144, total: 412 })} size={96} color="var(--ok)" />
          <ProgressRing value={1} label={formatPercent(1)} size={72} color="var(--rarity-legendary)" />
          <ProgressRing indeterminate size={56} strokeWidth={8} ariaLabel={t('common.uiKit.progress.busy')} />
        </div>
        <p className="bd-kit__hint">{t('common.uiKit.progress.meterHint')}</p>
        <input
          className="bd-kit__range"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={level}
          onChange={(event) => setLevel(Number(event.target.value))}
          aria-label={t('common.uiKit.progress.meterLabel')}
        />
        <div className="bd-kit__meters">
          <LevelMeter level={level} label={t('common.uiKit.progress.meterLabel')} />
          <LevelMeter level={level} orientation="vertical" segments={10} />
        </div>
      </Section>

      <Section title={t('common.uiKit.sections.confidence')}>
        <div className="bd-kit__stack">
          <div>
            <span className="bd-kit__caption">{t('common.uiKit.confidence.belowThreshold')}</span>
            <ConfidenceBar value={0.52} threshold={0.7} />
          </div>
          <div>
            <span className="bd-kit__caption">{t('common.uiKit.confidence.aboveThreshold')}</span>
            <ConfidenceBar value={0.88} threshold={0.7} />
          </div>
          <div>
            <span className="bd-kit__caption">{t('common.uiKit.confidence.noThreshold')}</span>
            <ConfidenceBar value={0.34} />
          </div>
        </div>
      </Section>

      <Section title={t('common.uiKit.sections.dialogs')}>
        <div className="bd-kit__row">
          <Button variant="secondary" onClick={() => setDialog('confirm')}>
            {t('common.uiKit.dialogs.openConfirm')}
          </Button>
          <Button variant="danger" onClick={() => setDialog('danger')}>
            {t('common.uiKit.dialogs.openDanger')}
          </Button>
        </div>
        <div className="bd-kit__row">
          <Button variant="secondary" icon="info" onClick={() => toast.show(t('common.uiKit.dialogs.toastInfoText'))}>
            {t('common.uiKit.dialogs.toastInfo')}
          </Button>
          <Button variant="secondary" icon="check" onClick={() => toast.show(t('common.uiKit.dialogs.toastSuccessText', { name: t('common.uiKit.sampleName') }), { tone: 'success' })}>
            {t('common.uiKit.dialogs.toastSuccess')}
          </Button>
          <Button variant="secondary" icon="warning" onClick={() => toast.show(t('common.uiKit.dialogs.toastErrorText'), { tone: 'error' })}>
            {t('common.uiKit.dialogs.toastError')}
          </Button>
        </div>
      </Section>

      <Section title={t('common.uiKit.sections.spinner')}>
        <div className="bd-kit__row bd-kit__row--center">
          <Spinner size="sm" />
          <Spinner />
          <Spinner size="lg" />
        </div>
      </Section>

      <Section title={t('common.uiKit.sections.empty')}>
        <EmptyState
          title={t('common.uiKit.empty.title')}
          message={t('common.uiKit.empty.message')}
          action={<Button icon="scan">{t('common.uiKit.empty.action')}</Button>}
        />
      </Section>

      <Section title={t('common.uiKit.sections.silhouettes')}>
        <div className="bd-kit__grid">
          {SILHOUETTE_SHAPES.map((shape) => (
            <figure key={shape} className="bd-kit__tile">
              <SpeciesSilhouette shape={shape} size={72} />
              <figcaption>{t(`common.uiKit.silhouettes.${shape}` as const)}</figcaption>
            </figure>
          ))}
          <figure className="bd-kit__tile bd-kit__tile--dark">
            <SpeciesSilhouette size={72} color="var(--lcd-glow)" />
            <figcaption>{t('common.uiKit.sampleName')}</figcaption>
          </figure>
          <figure className="bd-kit__tile">
            <SpeciesSilhouette size={72} color="var(--btn-blue)" />
            <figcaption>{t('common.uiKit.sampleScientific')}</figcaption>
          </figure>
        </div>
      </Section>

      <Section title={t('common.uiKit.sections.icons')}>
        <div className="bd-kit__grid bd-kit__grid--icons">
          {ICON_NAMES.map((name) => (
            <figure key={name} className="bd-kit__tile">
              <Icon name={name} size={28} />
              <figcaption>{t(`common.uiKit.icons.${name}` as const)}</figcaption>
            </figure>
          ))}
        </div>
      </Section>

      <Section title={t('common.uiKit.sections.lights')}>
        <p className="bd-kit__hint">{t('common.uiKit.lights.hint')}</p>
        <div className="bd-kit__row">
          {DEVICE_STATUSES.map((status) => (
            <Chip key={status} selected={lights === status} onClick={() => setLights(status)} tone={status === 'error' ? 'danger' : status === 'success' ? 'success' : 'info'}>
              {t(`common.device.${status}` as const)}
            </Chip>
          ))}
          <Chip onClick={() => setLights(null)}>{t('common.uiKit.lights.reset')}</Chip>
        </div>
        <div className="bd-kit__row">
          <Button variant="secondary" onClick={() => flash('success')}>
            {t('common.device.success')}
          </Button>
        </div>
      </Section>

      <ConfirmDialog
        open={dialog === 'confirm'}
        title={t('common.uiKit.dialogs.confirmTitle')}
        message={
          <>
            <p className="bd-kit__lcdtext">{t('common.uiKit.sampleName')}</p>
            <p>{t('common.uiKit.dialogs.confirmText')}</p>
          </>
        }
        onConfirm={() => {
          setDialog(null)
          toast.show(t('common.uiKit.dialogs.confirmed'), { tone: 'success' })
        }}
        onCancel={() => {
          setDialog(null)
          toast.show(t('common.uiKit.dialogs.cancelled'))
        }}
      />
      <ConfirmDialog
        open={dialog === 'danger'}
        tone="danger"
        title={t('common.uiKit.dialogs.dangerTitle')}
        message={<p>{t('common.uiKit.dialogs.dangerText')}</p>}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          setDialog(null)
          toast.show(t('common.uiKit.dialogs.confirmed'), { tone: 'success' })
        }}
        onCancel={() => setDialog(null)}
      />
    </Page>
  )
}
