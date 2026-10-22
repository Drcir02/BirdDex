import { useId, useState } from 'react'
import { t } from '../../i18n'
import { Icon } from '../../ui/icons'
import { TrainerCard } from '../settings/TrainerCard'

/**
 * The trainer card (the progress of the Dex, the rarest bird, the streak, the catches by way) in the Dex. It starts folded so
 * the grid of species stays in reach; the heading unfolds it, and the card is only built while it is open.
 */
export function TrainerFold() {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  return (
    <section className="bd-trainerfold" data-testid="trainer-fold">
      <h2 className="bd-trainerfold__title">
        <button type="button" className="bd-trainerfold__toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((was) => !was)} data-testid="trainer-toggle">
          <Icon name="bird" size={20} />
          <span>{t('settings.trainer.title')}</span>
          <Icon name="chevron" size={18} className="bd-trainerfold__chevron" />
        </button>
      </h2>
      <div id={bodyId} hidden={!open}>
        {open ? <TrainerCard /> : null}
      </div>
    </section>
  )
}
