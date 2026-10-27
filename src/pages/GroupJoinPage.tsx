// Joining a group with its code (typed, or from an invitation link or QR code: /group/join/CODE).
import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ROUTES } from '../app/routes'
import { t } from '../i18n'
import { Button, ButtonLink, LcdPanel, Notice, Page, PageHeader } from '../ui'
import { getGroupApi } from '../features/group/api'
import { colorFor } from '../features/group/colors'
import { joinErrorText, normalizeCode } from '../features/group/errors'
import { ProfileFields } from '../features/group/ProfileFields'
import { setMembership, useMembership } from '../features/group/state'
import '../features/group/group.css'

export default function GroupJoinPage() {
  const { code: linkCode = '' } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const membership = useMembership()
  const [code, setCode] = useState(normalizeCode(linkCode))
  const [nickname, setNickname] = useState('')
  const [color, setColor] = useState(() => colorFor(linkCode || 'birddex'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (membership) {
    return (
      <Page className="bd-group">
        <PageHeader title={t('group.join.title')} backTo={ROUTES.settings} />
        <Notice tone="info">
          <span data-testid="join-already">{t('group.join.already')}</span>
        </Notice>
        <ButtonLink to={ROUTES.group} icon="bird" fullWidth data-testid="join-to-group">
          {t('group.join.toGroup')}
        </ButtonLink>
      </Page>
    )
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const normalized = normalizeCode(code)
    const trimmed = nickname.trim()
    if (normalized.length < 4) return setError(t('group.join.errors.noCode'))
    if (trimmed.length < 1 || trimmed.length > 24) return setError(t('group.join.errors.noNickname'))
    setBusy(true)
    setError(null)
    try {
      const api = await getGroupApi()
      const userId = await api.session()
      const joined = await api.joinGroup({ code: normalized, nickname: trimmed, color })
      setMembership({
        groupId: joined.groupId,
        groupName: joined.groupName,
        code: normalized,
        nickname: trimmed,
        color,
        userId,
        isAdmin: false,
        joinedAt: Date.now(),
      })
      navigate(ROUTES.group, { replace: true })
    } catch (failure) {
      setError(joinErrorText(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page className="bd-group">
      <PageHeader title={t('group.join.title')} backTo={ROUTES.settings} />
      <form onSubmit={(event) => void submit(event)} noValidate>
        <LcdPanel>
          <div className="bd-field">
            <label htmlFor="group-code" className="bd-field__label">
              {t('group.join.codeLabel')}
            </label>
            <input
              id="group-code"
              className="bd-field__input bd-field__input--code"
              type="text"
              value={code}
              maxLength={16}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder={t('group.join.codePlaceholder')}
              onChange={(event) => setCode(normalizeCode(event.target.value))}
              data-testid="code-input"
            />
            <p className="bd-field__hint">{t('group.join.codeHint')}</p>
          </div>
          <ProfileFields nickname={nickname} color={color} onNickname={setNickname} onColor={setColor} />
        </LcdPanel>

        <LcdPanel title={t('group.join.sharedTitle')} titleLevel={3} className="bd-group__consent" data-testid="join-consent">
          <ul>
            {(['what', 'picture', 'place', 'who', 'control'] as const).map((key) => (
              <li key={key}>{t(`group.join.shared.${key}` as const)}</li>
            ))}
          </ul>
        </LcdPanel>

        {error ? (
          <Notice tone="error">
            <span data-testid="join-error">{error}</span>
          </Notice>
        ) : null}
        <Button type="submit" size="lg" icon="check" fullWidth busy={busy} data-testid="join-submit">
          {t('group.join.submit')}
        </Button>
      </form>
    </Page>
  )
}
