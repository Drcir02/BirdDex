import { useState } from 'react'
import { ROUTES } from '../../app/routes'
import { getSpeciesById } from '../../data/species'
import { useSpecies } from '../../data/useSpecies'
import { useCaughtSummary } from '../../db'
import { t } from '../../i18n'
import { Button, ButtonLink, Chip, ConfirmDialog, EmptyState, Notice, Spinner } from '../../ui'
import { useToast } from '../../ui/Toast'
import { getGroupApi } from './api'
import { FeedCard } from './FeedCard'
import { useMembership } from './state'
import { useFeed, useMediaUrls, type FeedFilter } from './useFeed'
import './group.css'

const FILTERS: readonly FeedFilter[] = ['all', 'new', 'mine']
const FILTER_KEY = { all: 'group.feed.filter.all', new: 'group.feed.filter.newOnly', mine: 'group.feed.filter.mine' } as const

/** The feed: the newest catches of the members first, with a filter, a refresh and "older". */
export function FeedView({ refreshSignal = 0 }: { refreshSignal?: number }) {
  const membership = useMembership()
  const toast = useToast()
  const { species } = useSpecies()
  const summary = useCaughtSummary()
  const [filter, setFilter] = useState<FeedFilter>('all')
  const feed = useFeed(filter, refreshSignal)
  const urls = useMediaUrls(feed.posts)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!membership) return null

  const react = async (postId: string, on: boolean) => {
    if (!(await feed.react(postId, on))) toast.show(t('group.post.reactFailed'), { tone: 'error' })
  }
  const confirmDelete = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      const api = await getGroupApi()
      await api.deletePost(membership.groupId, deleting)
      feed.drop(deleting)
      toast.show(t('group.post.deleted'), { tone: 'success' })
    } catch {
      toast.show(t('group.post.deleteFailed'), { tone: 'error' })
    } finally {
      setBusy(false)
      setDeleting(null)
    }
  }

  return (
    <div className="bd-feed" data-testid="feed">
      <div className="bd-feed__bar">
        <div className="bd-feed__filters" role="group" aria-label={t('group.feed.filterLabel')}>
          {FILTERS.map((value) => (
            <Chip key={value} tone="neutral" selected={filter === value} onClick={() => setFilter(value)} data-testid={`feed-filter-${value}`}>
              {t(FILTER_KEY[value])}
            </Chip>
          ))}
        </div>
      </div>

      {feed.offline ? (
        <Notice tone="info">
          <span data-testid="feed-offline">{t('group.feed.offline')}</span>
        </Notice>
      ) : null}
      {feed.failed && feed.posts.length === 0 ? (
        <Notice tone="error" action={<Button onClick={feed.refresh}>{t('group.feed.retry')}</Button>}>
          {t('group.feed.error')}
        </Notice>
      ) : null}

      {feed.loading ? (
        <div className="bd-feed__loading" role="status">
          <Spinner size="lg" label={null} />
          <p>{t('group.loading')}</p>
        </div>
      ) : feed.posts.length === 0 && !feed.failed ? (
        filter === 'all' ? (
          <EmptyState
            title={t('group.feed.empty.title')}
            message={t('group.feed.empty.text')}
            action={
              <ButtonLink to={ROUTES.scan} icon="scan">
                {t('group.feed.empty.action')}
              </ButtonLink>
            }
          />
        ) : (
          <p className="bd-feed__none" data-testid="feed-none">
            {filter === 'new' ? t('group.feed.emptyNew') : t('group.feed.emptyMine')}
          </p>
        )
      ) : (
        <ul className="bd-feed__list">
          {feed.posts.map((post) => (
            <FeedCard
              key={post.id}
              post={post}
              species={species ? getSpeciesById(post.speciesId, species) : undefined}
              mediaUrl={post.mediaPath ? urls[post.mediaPath] : undefined}
              inMyDex={summary.bySpecies.has(post.speciesId)}
              isMine={post.userId === membership.userId}
              canDelete={membership.isAdmin}
              onReact={(id, on) => void react(id, on)}
              onDelete={setDeleting}
            />
          ))}
        </ul>
      )}

      {feed.hasMore ? (
        <Button variant="secondary" fullWidth busy={feed.loadingMore} onClick={feed.loadMore} data-testid="feed-more">
          {t('group.feed.loadMore')}
        </Button>
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        tone="danger"
        busy={busy}
        title={t('group.post.deleteTitle')}
        message={<p>{t('group.post.deleteMessage')}</p>}
        confirmLabel={t('group.post.deleteConfirm')}
        cancelLabel={t('group.post.deleteCancel')}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}
