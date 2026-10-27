// One member: their numbers, strongest birds and latest catches.
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { ROUTES, groupPath } from '../app/routes'
import { displayName, getSpeciesById, rarityRank } from '../data/species'
import { useSpecies } from '../data/useSpecies'
import { useCaughtSummary } from '../db'
import { t } from '../i18n'
import { Button, ButtonLink, EmptyState, LcdPanel, Notice, Page, PageHeader, Spinner } from '../ui'
import { useToast } from '../ui/Toast'
import { Avatar } from '../features/group/Avatar'
import { boardValueText } from '../features/group/BoardView'
import { FeedCard } from '../features/group/FeedCard'
import { getGroupApi } from '../features/group/api'
import { useMembership } from '../features/group/state'
import type { FeedPost, GroupApi } from '../features/group/types'
import { useMediaUrls } from '../features/group/useFeed'
import { useRemote } from '../features/group/useRemote'
import '../features/group/group.css'

/** Up to 300 posts of one member, in pages of 50 (the server's page size). */
async function postsOf(api: GroupApi, groupId: string, userId: string): Promise<FeedPost[]> {
  const all: FeedPost[] = []
  for (let page = 0; page < 6; page++) {
    const posts = await api.feed(groupId, { limit: 50, userId, before: all.length ? all[all.length - 1].createdAt : undefined })
    all.push(...posts)
    if (posts.length < 50) break
  }
  return all
}

export default function GroupMemberPage() {
  const { userId = '' } = useParams<{ userId: string }>()
  const membership = useMembership()
  const toast = useToast()
  const { species } = useSpecies()
  const summary = useCaughtSummary()
  const groupId = membership?.groupId
  const members = useRemote((api) => api.members(groupId as string), [groupId])
  const board = useRemote(
    async (api) => {
      const rows = await Promise.all((['species', 'catches', 'streak', 'strongest'] as const).map((name) => api.leaderboard(groupId as string, name)))
      return { species: rows[0], catches: rows[1], streak: rows[2], strongest: rows[3] }
    },
    [groupId],
  )
  const posts = useRemote((api) => postsOf(api, groupId as string, userId), [groupId, userId])
  const urls = useMediaUrls((posts.data ?? []).slice(0, 10))
  // A Super given on this page shows at once; the server's answer replaces it with the next load.
  const [given, setGiven] = useState<Record<string, boolean>>({})

  if (!membership) {
    return (
      <Page className="bd-group">
        <PageHeader title={t('group.profile.title')} backTo={ROUTES.group} />
        <EmptyState title={t('group.none.title')} />
      </Page>
    )
  }
  const member = members.data?.find((item) => item.userId === userId)
  if (members.data && !member) {
    return (
      <Page className="bd-group">
        <PageHeader title={t('group.profile.title')} backTo={ROUTES.group} />
        <EmptyState title={t('group.profile.notFound')} action={<ButtonLink to={groupPath('members')}>{t('group.back')}</ButtonLink>} />
      </Page>
    )
  }
  if (!member) {
    return (
      <Page className="bd-group">
        <PageHeader title={t('group.profile.title')} backTo={ROUTES.group} />
        {members.failed ? (
          <Notice tone="error" action={<Button onClick={members.reload}>{t('group.feed.retry')}</Button>}>
            {t('group.members.error')}
          </Notice>
        ) : (
          <div className="bd-feed__loading" role="status">
            <Spinner size="lg" label={null} />
          </div>
        )}
      </Page>
    )
  }

  const valueOf = (name: 'species' | 'catches' | 'streak' | 'strongest') => board.data?.[name].find((row) => row.userId === userId)
  const list = (posts.data ?? []).map((post) =>
    post.id in given && given[post.id] !== post.iReacted
      ? { ...post, iReacted: given[post.id], reactions: Math.max(0, post.reactions + (given[post.id] ? 1 : -1)) }
      : post,
  )
  const react = async (postId: string, on: boolean) => {
    setGiven((previous) => ({ ...previous, [postId]: on }))
    try {
      const api = await getGroupApi()
      await api.react(postId, on)
    } catch {
      setGiven((previous) => ({ ...previous, [postId]: !on }))
      toast.show(t('group.post.reactFailed'), { tone: 'error' })
    }
  }
  const strongest = [...list]
    .filter((post) => post.bp !== undefined)
    .sort((a, b) => (b.bp as number) - (a.bp as number))
    .slice(0, 5)
  const rarest = species
    ? list
        .map((post) => getSpeciesById(post.speciesId, species))
        .filter((found): found is NonNullable<typeof found> => !!found)
        .sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity))[0]
    : undefined
  const caughtSpecies = valueOf('species')?.value
  const mine = userId === membership.userId

  return (
    <Page className="bd-group bd-member">
      <PageHeader title={t('group.profile.title')} backTo={groupPath('members')} />
      <LcdPanel className="bd-member__top" data-testid="member-profile">
        <Avatar nickname={member.nickname} color={member.color} size="lg" />
        <h2 className="bd-member__nick" data-testid="member-nick">
          {member.nickname}
        </h2>
        <dl className="bd-member__stats">
          <div>
            <dt>{t('group.profile.speciesLabel')}</dt>
            <dd data-testid="member-species">
              {caughtSpecies !== undefined && species ? t('group.profile.speciesOf', { caught: caughtSpecies, total: species.length }) : '–'}
            </dd>
          </div>
          <div>
            <dt>{t('group.profile.catchesLabel')}</dt>
            <dd data-testid="member-catches">{valueOf('catches')?.value ?? '–'}</dd>
          </div>
          <div>
            <dt>{t('group.profile.streakLabel')}</dt>
            <dd data-testid="member-streak">{valueOf('streak') ? boardValueText('streak', valueOf('streak')!.value) : '–'}</dd>
          </div>
          <div>
            <dt>{t('group.profile.strongestLabel')}</dt>
            <dd data-testid="member-strongest">{valueOf('strongest') ? boardValueText('strongest', valueOf('strongest')!.value) : '–'}</dd>
          </div>
          {rarest ? (
            <div>
              <dt>{t('group.profile.rarestLabel')}</dt>
              <dd>{displayName(rarest)}</dd>
            </div>
          ) : null}
        </dl>
      </LcdPanel>

      {posts.loading && !posts.data ? (
        <div className="bd-feed__loading" role="status">
          <Spinner size="lg" label={null} />
        </div>
      ) : list.length === 0 ? (
        <p className="bd-feed__none" data-testid="member-empty">
          {t('group.profile.noPosts')}
        </p>
      ) : (
        <>
          <LcdPanel title={t('group.profile.top')} data-testid="member-top">
            <ol className="bd-member__top5">
              {strongest.map((post) => {
                const found = species ? getSpeciesById(post.speciesId, species) : undefined
                return (
                  <li key={post.id} className="bd-member__bird" data-bp={post.bp}>
                    <strong>{post.bp}</strong>
                    <span>{found ? displayName(found) : t('group.post.unknownSpecies')}</span>
                  </li>
                )
              })}
            </ol>
          </LcdPanel>
          <h2 className="bd-member__heading">{t('group.profile.latest')}</h2>
          <ul className="bd-feed__list" data-testid="member-posts">
            {list.slice(0, 10).map((post) => (
              <FeedCard
                key={post.id}
                post={post}
                species={species ? getSpeciesById(post.speciesId, species) : undefined}
                mediaUrl={post.mediaPath ? urls[post.mediaPath] : undefined}
                inMyDex={summary.bySpecies.has(post.speciesId)}
                isMine={mine}
                canDelete={false}
                onReact={(id, on) => void react(id, on)}
                onDelete={() => undefined}
                compact
              />
            ))}
          </ul>
        </>
      )}
    </Page>
  )
}
