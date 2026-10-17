import { t } from '../../i18n'
import { useSettings } from '../../state/settings'
import { Button, LcdPanel, Switch } from '../../ui'
import { playSound, unlockAudio } from '../fun/sounds'
import './settings.css'

export function SoundSection() {
  const { settings, update } = useSettings()
  return (
    <LcdPanel title={t('settings.sounds.title')} data-testid="sound-section">
      <div className="bd-set-section">
        <Switch
          checked={settings.soundEffects}
          label={t('settings.sounds.label')}
          description={t('settings.sounds.hint')}
          onChange={(checked) => {
            update({ soundEffects: checked })
            if (checked) {
              // Inside the tap, so iOS lets the audio start. A short blip shows that it works.
              unlockAudio()
              playSound('lock')
            }
          }}
        />
        {settings.soundEffects ? (
          <Button variant="secondary" icon="speaker" onClick={() => playSound('catch', 'rare')} data-testid="sound-preview">
            {t('settings.sounds.preview')}
          </Button>
        ) : null}
      </div>
    </LcdPanel>
  )
}
