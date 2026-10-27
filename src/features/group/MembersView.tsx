import { useState } from 'react'
import { Link } from 'react-router-dom'
import { groupMemberPath } from '../../app/routes'
import { formatDate, pluralIndex, t } from '../../i18n'
import { Button, Chip, ConfirmDialog, Notice, Spinner } from '../../ui'
import { useToast } from '../../ui/Toast'
import { getGroupApi } from './api'
import { Avatar } from './Avatar'
import { useMembership } from './state'
import { useRemote } from './useRemote'
import './group.css'

export function MembersView({ refreshSignal = 0 }: { refreshSignal?: number }) {
  const membership = useMembership()
  const toast = useToast()
  const groupId = membership?.groupId
  const remote = useRemote((api) => api.members(groupId as string), [groupId, refreshSignal])
  const [removing, setRemoving] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!membership) return null

  const members = remote.data ?? []
  const form = pluralIndex(members.length) === 0 ? 'one' : pluralIndex(members.length) === 1 ? 'few' : 'many'
  const confirmRemove = async () => {
    if (!removing) return
    setBusy(true)
    try {
      const api = await getGroupApi()
      await api.removeMember(membership.groupId, removing)
      toast.show(t('group.members.removed'), { tone: 'success' })
      remote.reload()
    } catch {
      toast.show(t('group.members.removeFailed'), { tone: 'error' })
    } finally {
      setBusy(false)
      setRemoving(null)
    }
  }

  return (
    <div className="bd-members" data-testid="members">
      {remote.failed && !remote.data ? (
        <Notice tone="error" action={<Button onClick={remote.reload}>{t('group.feed.retry')}</Button>}>
          {t('group.members.error')}
        </Notice>
      ) : remote.loading && !remote.data ? (
        <div className="bd-feed__loading" role="status">
          <Spinner size="lg" label={null} />
        </div>
      ) : (
        <>
          <p className="bd-members__count" data-testid="members-count">
            {t(`group.members.count.${form}` as const, { count: members.length })}
          </p>
          <ul className="bd-members__list">
            {members.map((member) => (
              <li key={member.userId} className="bd-members__row" data-testid="member-row" data-user-id={member.userId}>
                <Link to={groupMemberPath(member.userId)} className="bd-members__link">
                  <Avatar nickname={member.nickname} color={member.color} />
                  <span className="bd-members__text">
                    <span className="bd-members__nick">
                      {member.nickname}
                      {member.userId === membership.userId ? <em> ({t('group.members.you')})</em> : null}
                    </span>
                    <small>{t('group.members.since', { date: formatDate(member.joinedAt) })}</small>
                  </span>
                  {member.isAdmin ? <Chip tone="info">{t('group.members.admin')}</Chip> : null}
                </Link>
                {membership.isAdmin && member.userId !== membership.userId ? (
                  <Button
                    variant="secondary"
                    icon="trash"
                    aria-label={`${t('group.members.remove')}: ${member.nickname}`}
                    onClick={() => setRemoving(member.userId)}
                    data-testid="member-remove"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
      <ConfirmDialog
        open={removing !== null}
        tone="danger"
        busy={busy}
        title={t('group.members.removeTitle')}
        message={<p>{t('group.members.removeMessage')}</p>}
        confirmLabel={t('group.members.removeConfirm')}
        cancelLabel={t('group.members.removeCancel')}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoving(null)}
      />
    </div>
  )
}
