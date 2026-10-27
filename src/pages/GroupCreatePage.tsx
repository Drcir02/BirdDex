// Creating a group: the founder code (a secret of the maker of the app) lets a person start one.
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ROUTES } from '../app/routes'
import { t } from '../i18n'
import { Button, ButtonLink, LcdPanel, Notice, Page, PageHeader } from '../ui'
import { getGroupApi } from '../features/group/api'
import { DEFAULT_MEMBER_COLOR } from '../features/group/colors'
import { joinErrorText } from '../features/group/errors'
import { InvitePanel } from '../features/group/InvitePanel'
import { ProfileFields } from '../features/group/ProfileFields'
import { setMembership, useMembership } from '../features/group/state'
import '../features/group/group.css'

export default function GroupCreatePage() {
  const navigate = useNavigate()
  const membership = useMembership()
  const [founder, setFounder] = useState('')
  const [name, setName] = useState('')
  const [nickname, setNickname] = useState('')
  const [color, setColor] = useState<string>(DEFAULT_MEMBER_COLOR)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState(false)

  if (membership && !created) {
    return (
      <Page className="bd-group">
        <PageHeader title={t('group.create.title')} backTo={ROUTES.settings} />
        <Notice tone="info">
          <span data-testid="join-already">{t('group.join.already')}</span>
        </Notice>
        <ButtonLink to={ROUTES.group} icon="bird" fullWidth>
          {t('group.join.toGroup')}
        </ButtonLink>
      </Page>
    )
  }

  if (membership && created) {
    return (
      <Page className="bd-group">
        <PageHeader title={t('group.create.doneTitle')} />
        <LcdPanel>
          <p>{t('group.create.doneText')}</p>
        </LcdPanel>
        <InvitePanel code={membership.code} groupName={membership.groupName} />
        <Button size="lg" icon="check" fullWidth onClick={() => navigate(ROUTES.group, { replace: true })} data-testid="create-to-group">
          {t('group.join.toGroup')}
        </Button>
      </Page>
    )
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const trimmedName = name.trim()
    const trimmedNick = nickname.trim()
    if (!founder.trim()) return setError(t('group.create.errors.noFounder'))
    if (trimmedName.length < 1 || trimmedName.length > 40) return setError(t('group.create.errors.noName'))
    if (trimmedNick.length < 1 || trimmedNick.length > 24) return setError(t('group.join.errors.noNickname'))
    setBusy(true)
    setError(null)
    try {
      const api = await getGroupApi()
      const userId = await api.session()
      const made = await api.createGroup({ founderCode: founder, name: trimmedName, nickname: trimmedNick, color })
      setCreated(true)
      setMembership({
        groupId: made.groupId,
        groupName: made.groupName,
        code: made.code,
        nickname: trimmedNick,
        color,
        userId,
        isAdmin: true,
        joinedAt: Date.now(),
      })
    } catch (failure) {
      setError(joinErrorText(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page className="bd-group">
      <PageHeader title={t('group.create.title')} backTo={ROUTES.settings} />
      <form onSubmit={(event) => void submit(event)} noValidate>
        <LcdPanel>
          <p>{t('group.create.intro')}</p>
          <div className="bd-field">
            <label htmlFor="founder-code" className="bd-field__label">
              {t('group.create.founderLabel')}
            </label>
            <input
              id="founder-code"
              className="bd-field__input bd-field__input--code"
              type="password"
              value={founder}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              onChange={(event) => setFounder(event.target.value)}
              data-testid="founder-input"
            />
            <p className="bd-field__hint">{t('group.create.founderHint')}</p>
          </div>
          <div className="bd-field">
            <label htmlFor="group-name" className="bd-field__label">
              {t('group.create.nameLabel')}
            </label>
            <input
              id="group-name"
              className="bd-field__input"
              type="text"
              value={name}
              maxLength={40}
              autoComplete="off"
              placeholder={t('group.create.namePlaceholder')}
              onChange={(event) => setName(event.target.value)}
              data-testid="group-name-input"
            />
          </div>
          <ProfileFields nickname={nickname} color={color} onNickname={setNickname} onColor={setColor} />
        </LcdPanel>
        {error ? (
          <Notice tone="error">
            <span data-testid="join-error">{error}</span>
          </Notice>
        ) : null}
        <Button type="submit" size="lg" icon="check" fullWidth busy={busy} data-testid="create-submit">
          {t('group.create.submit')}
        </Button>
      </form>
    </Page>
  )
}
