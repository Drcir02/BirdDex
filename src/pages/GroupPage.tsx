// The group: the feed of catches, the leaderboards and the members, behind a switch. The round key next to the gear opens it.
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ROUTES } from '../app/routes'
import { t } from '../i18n'
import { Button, ButtonLink, EmptyState, IconButton, Notice, Page, PageHeader, SegmentedControl } from '../ui'
import { BoardView } from '../features/group/BoardView'
import { FeedView } from '../features/group/FeedView'
import { MembersView } from '../features/group/MembersView'
import { dismissRemoved, useGroupState } from '../features/group/state'
import '../features/group/group.css'

type Tab = 'feed' | 'board' | 'members'
const TABS: readonly Tab[] = ['feed', 'board', 'members']

export default function GroupPage() {
  const { membership, removedFrom } = useGroupState()
  const [params, setParams] = useSearchParams()
  // Pressing the refresh key makes the part on the screen ask the server again.
  const [refreshSignal, setRefreshSignal] = useState(0)
  const requested = params.get('tab')
  const tab: Tab = TABS.includes(requested as Tab) ? (requested as Tab) : 'feed'

  if (!membership) {
    return (
      <Page className="bd-group">
        <PageHeader title={t('group.title')} />
        {removedFrom ? (
          <Notice tone="warning" action={<Button onClick={dismissRemoved}>{t('group.removedDismiss')}</Button>}>
            <span data-testid="group-removed">{t('group.removed', { name: removedFrom })}</span>
          </Notice>
        ) : null}
        <EmptyState
          title={t('group.none.title')}
          message={t('group.none.text')}
          action={
            <div className="bd-group__actions">
              <ButtonLink to={ROUTES.groupJoin} icon="upload" data-testid="none-join">
                {t('group.none.join')}
              </ButtonLink>
              <ButtonLink to={ROUTES.groupCreate} variant="secondary" icon="bird" data-testid="none-create">
                {t('group.none.create')}
              </ButtonLink>
            </div>
          }
        />
      </Page>
    )
  }

  return (
    <Page className="bd-group">
      <PageHeader
        title={t('group.title')}
        subtitle={<span data-testid="group-title-name">{membership.groupName}</span>}
        actions={
          <IconButton
            icon="refresh"
            label={t('group.feed.refresh')}
            onClick={() => setRefreshSignal((value) => value + 1)}
            data-testid="group-refresh"
          />
        }
      />
      <SegmentedControl<Tab>
        label={t('group.tabs.label')}
        value={tab}
        options={TABS.map((value) => ({ value, label: t(`group.tabs.${value}` as const) }))}
        onChange={(value) => setParams(value === 'feed' ? {} : { tab: value }, { replace: true })}
      />
      {tab === 'feed' ? (
        <FeedView refreshSignal={refreshSignal} />
      ) : tab === 'board' ? (
        <BoardView refreshSignal={refreshSignal} />
      ) : (
        <MembersView refreshSignal={refreshSignal} />
      )}
    </Page>
  )
}
