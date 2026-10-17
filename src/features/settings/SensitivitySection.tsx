import { t } from '../../i18n'
import { useSettings } from '../../state/settings'
import { LcdPanel, SegmentedControl } from '../../ui'
import { isSensitivity, sensitivityNumbers } from './sensitivity'
import './settings.css'

const INFO = { strict: 'settings.sensitivity.strictInfo', normal: 'settings.sensitivity.normalInfo', easy: 'settings.sensitivity.easyInfo' } as const

export function SensitivitySection() {
  const { settings, update } = useSettings()
  const numbers = sensitivityNumbers(settings.sensitivity)
  return (
    <LcdPanel title={t('settings.sensitivity.title')} data-testid="sensitivity-section">
      <div className="bd-set-section">
        <p className="bd-set-hint">{t('settings.sensitivity.hint')}</p>
        <SegmentedControl
          label={t('settings.sensitivity.label')}
          value={settings.sensitivity}
          options={[
            { value: 'strict', label: t('settings.sensitivity.strict') },
            { value: 'normal', label: t('settings.sensitivity.normal') },
            { value: 'easy', label: t('settings.sensitivity.easy') },
          ]}
          onChange={(value) => {
            if (isSensitivity(value)) update({ sensitivity: value })
          }}
        />
        <div className="bd-set-explain" data-testid="sensitivity-info" data-level={settings.sensitivity} aria-live="polite">
          <p>{t(INFO[settings.sensitivity])}</p>
          <p className="bd-set-explain__numbers">{t('settings.sensitivity.numbers', { sound: numbers.sound, photo: numbers.photo })}</p>
        </div>
      </div>
    </LcdPanel>
  )
}
