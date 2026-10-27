import { useState } from 'react'
import { ROUTES } from '../../app/routes'
import { t } from '../../i18n'
import { Button, ButtonLink, Chip, ConfirmDialog, LcdPanel, SegmentedControl, Switch } from '../../ui'
import { useToast } from '../../ui/Toast'
import { getGroupApi } from './api'
import { Avatar } from './Avatar'
import { InvitePanel } from './InvitePanel'
import { ProfileFields } from './ProfileFields'
import { leaveAndForget } from './share'
import { updateMembership, updatePrefs, useGroupState } from './state'
import { PLACE_MODES, type PlaceMode } from './types'
import { joinErrorText } from './errors'
import '../settings/settings.css'
import './group.css'

/** The group in the settings: join or create, or (when in one) the profile, the invitation, how things are shared, and leaving. */
export function GroupSection() {
  const { membership, prefs } = useGroupState()
  const toast = useToast()
  const [nickname, setNickname] = useState('')
  const [color, setColor] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!membership) {
    return (
      <LcdPanel title={t('group.settings.title')} data-testid="group-section">
        <div className="bd-set-section">
          <p>{t('group.settings.none')}</p>
          <ButtonLink to={ROUTES.groupJoin} icon="upload" fullWidth data-testid="group-join-link">
            {t('group.settings.join')}
          </ButtonLink>
          <ButtonLink to={ROUTES.groupCreate} variant="secondary" icon="bird" fullWidth data-testid="group-create-link">
            {t('group.settings.create')}
          </ButtonLink>
        </div>
      </LcdPanel>
    )
  }

  const startEdit = () => {
    setNickname(membership.nickname)
    setColor(membership.color)
    setError(null)
    setEditing(true)
  }
  const changed = editing && (nickname.trim() !== membership.nickname || color.toLowerCase() !== membership.color.toLowerCase())
  const saveProfile = async () => {
    const trimmed = nickname.trim()
    if (trimmed.length < 1 || trimmed.length > 24) {
      setError(t('group.join.errors.noNickname'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const api = await getGroupApi()
      await api.updateProfile(membership.groupId, { nickname: trimmed, color })
      updateMembership({ nickname: trimmed, color })
      setEditing(false)
      toast.show(t('group.settings.saved'), { tone: 'success' })
    } catch (failure) {
      setError(joinErrorText(failure))
    } finally {
      setBusy(false)
    }
  }
  const leave = async () => {
    setBusy(true)
    try {
      await leaveAndForget()
      setLeaving(false)
      toast.show(t('group.settings.left'), { tone: 'success' })
    } catch {
      setLeaving(false)
      toast.show(t('group.settings.leaveFailed'), { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <LcdPanel title={t('group.settings.title')} data-testid="group-section">
        <div className="bd-set-section">
          <div className="bd-set-group__who">
            <Avatar nickname={membership.nickname} color={membership.color} />
            <div>
              <p className="bd-set-group__name" data-testid="group-name">
                {membership.groupName}
              </p>
              <p className="bd-set-hint" data-testid="group-nickname">
                {membership.nickname}
              </p>
            </div>
            {membership.isAdmin ? <Chip tone="info">{t('group.members.admin')}</Chip> : null}
          </div>
          <ButtonLink to={ROUTES.group} icon="bird" fullWidth data-testid="group-open">
            {t('group.settings.open')}
          </ButtonLink>

          {editing ? (
            <>
              <ProfileFields nickname={nickname} color={color} onNickname={setNickname} onColor={setColor} hint={false} />
              {error ? (
                <p className="bd-field__error" role="alert" data-testid="group-error">
                  {error}
                </p>
              ) : null}
              <div className="bd-set-row">
                <Button icon="check" busy={busy} disabled={!changed} onClick={() => void saveProfile()} data-testid="group-profile-save">
                  {t('group.settings.save')}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => setEditing(false)}>
                  {t('group.settings.leaveCancel')}
                </Button>
              </div>
            </>
          ) : (
            <Button variant="secondary" icon="settings" fullWidth onClick={startEdit} data-testid="group-profile-edit">
              {t('group.settings.nicknameLabel')}, {t('group.settings.colorLabel').toLowerCase()}
            </Button>
          )}

          <Switch
            checked={prefs.autoShare}
            label={t('group.settings.autoShare')}
            description={t('group.settings.autoShareHint')}
            onChange={(checked) => updatePrefs({ autoShare: checked })}
          />
          <SegmentedControl<PlaceMode>
            label={t('group.settings.placeGroup')}
            value={prefs.place}
            options={PLACE_MODES.map((value) => ({ value, label: t(`group.settings.place.${value}` as const) }))}
            onChange={(value) => updatePrefs({ place: value })}
          />
          <p className="bd-set-hint" data-testid="group-place-hint">
            {t(`group.settings.placeHint.${prefs.place}` as const)}
          </p>
          <Button variant="danger" icon="trash" fullWidth onClick={() => setLeaving(true)} data-testid="group-leave">
            {t('group.settings.leave')}
          </Button>
        </div>
      </LcdPanel>
      <InvitePanel code={membership.code} groupName={membership.groupName} />
      <ConfirmDialog
        open={leaving}
        tone="danger"
        busy={busy}
        title={t('group.settings.leaveTitle')}
        message={<p>{t('group.settings.leaveMessage')}</p>}
        confirmLabel={t('group.settings.leaveConfirm')}
        cancelLabel={t('group.settings.leaveCancel')}
        onConfirm={() => void leave()}
        onCancel={() => setLeaving(false)}
      />
    </>
  )
}
