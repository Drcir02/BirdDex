import { useState } from 'react'
import { getCatch, useLiveQuery } from '../../db'
import type { CatchRecord } from '../../domain/types'
import { t } from '../../i18n'
import { LcdPanel, Switch } from '../../ui'
import { useToast } from '../../ui/Toast'
import { changeShare } from './share'
import { useGroupState } from './state'
import './group.css'

const NO_RECORDS: CatchRecord[] = []

/**
 * The switches of one bird for the group: share it or keep it to yourself, and show its place or not. Shown on the success
 * screens (within the few seconds before the catch is sent) and on the page of the bird. Nothing is shown for a catch that was
 * made without a group or before joining one: such a catch is never shared.
 */
export function ShareControl(props: { catchId?: string; catchIds?: readonly string[] }) {
  const { membership } = useGroupState()
  return membership ? <ShareSwitches {...props} /> : null
}

function ShareSwitches({ catchId, catchIds }: { catchId?: string; catchIds?: readonly string[] }) {
  const { membership, prefs } = useGroupState()
  const ids = catchIds ?? (catchId ? [catchId] : [])
  const idsKey = ids.join('|')
  const live = useLiveQuery(
    async () => (await Promise.all(ids.map((id) => getCatch(id)))).filter((found): found is CatchRecord => !!found),
    [idsKey],
    NO_RECORDS,
  )
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  // Several birds of one recording are switched together; the first one stands for them.
  const records = live.value.filter((found) => found.shareState !== undefined)
  const record = records[0]
  if (!membership || !record) return null

  const shared = record.shareState !== 'hidden'
  const hasPlace = !!record.placeName || !!record.location
  const placeShown = (record.sharePlace ?? prefs.place) !== 'none'
  const apply = async (change: Parameters<typeof changeShare>[1]) => {
    if (busy) return
    setBusy(true)
    try {
      for (const each of records) await changeShare(each.id, change)
    } catch {
      toast.show(t('group.share.failed'), { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }
  const state = record.shareState === 'sent' ? 'stateSent' : record.shareState === 'pending' ? 'statePending' : 'stateHidden'

  return (
    <LcdPanel title={t('group.title')} titleLevel={3} className="bd-share" data-testid="share-control" data-share-state={record.shareState}>
      <Switch
        checked={shared}
        disabled={busy}
        label={t('group.share.label')}
        description={t(`group.share.${state}` as const)}
        onChange={(checked) => void apply({ shared: checked })}
      />
      {shared && hasPlace ? (
        <Switch
          checked={placeShown}
          disabled={busy}
          label={t('group.share.place')}
          description={t('group.share.placeHint')}
          onChange={(checked) => void apply({ place: checked ? (prefs.place === 'none' ? 'name' : null) : 'none' })}
        />
      ) : null}
    </LcdPanel>
  )
}
