import { useState } from 'react'
import { Link } from 'react-router-dom'
import { groupMemberPath } from '../../app/routes'
import { displayName, getSpeciesById } from '../../data/species'
import { useSpecies } from '../../data/useSpecies'
import { pluralIndex, t } from '../../i18n'
import { Button, Chip, EmptyState, Notice, SegmentedControl, Spinner } from '../../ui'
import { Avatar } from './Avatar'
import { periodStart, withRanks } from './compute'
import { useMembership } from './state'
import { BOARDS, PERIODS, type Board, type BoardRow, type Period } from './types'
import { useRemote } from './useRemote'
import './group.css'

const POLL_MS = 60_000

/** "41 druhů", "BP 1878", "5 dní": the value of a row in the words of its board. */
export function boardValueText(board: Board, value: number): string {
  if (board === 'strongest') return value > 0 ? t('group.board.value.strongest', { count: value }) : '–'
  const form = pluralIndex(value) === 0 ? 'one' : pluralIndex(value) === 1 ? 'few' : 'many'
  return t(`group.board.value.${board}.${form}` as const, { count: value })
}

export function BoardView({ refreshSignal = 0 }: { refreshSignal?: number }) {
  const membership = useMembership()
  const { species } = useSpecies()
  const [board, setBoard] = useState<Board>('species')
  const [period, setPeriod] = useState<Period>('all')
  const groupId = membership?.groupId
  const remote = useRemote((api) => api.leaderboard(groupId as string, board, periodStart(period)), [groupId, board, period, refreshSignal], POLL_MS)
  if (!membership) return null

  const ranked = withRanks(remote.data ?? [])
  const podium = ranked.filter((row) => row.value > 0).slice(0, 3)
  const rest = ranked.filter((row) => !podium.includes(row))
  // The podium shows the second place on the left, the first in the middle and the third on the right.
  const podiumOrder = [podium[1], podium[0], podium[2]]

  const speciesLine = (row: BoardRow): string | null => {
    if (board !== 'strongest' || !row.speciesId || !species) return null
    const found = getSpeciesById(row.speciesId, species)
    return found ? displayName(found) : null
  }

  return (
    <div className="bd-board" data-testid="board">
      <SegmentedControl<Period>
        label={t('group.board.periodGroup')}
        value={period}
        options={PERIODS.map((value) => ({ value, label: t(`group.board.period.${value}` as const) }))}
        onChange={setPeriod}
      />
      <div className="bd-board__tabs" role="group" aria-label={t('group.board.boardGroup')}>
        {BOARDS.map((value) => (
          <Chip key={value} tone="neutral" selected={board === value} onClick={() => setBoard(value)} data-testid={`board-${value}`}>
            {t(`group.board.boards.${value}` as const)}
          </Chip>
        ))}
      </div>
      <p className="bd-board__hint">{t(`group.board.hint.${board}` as const)}</p>

      {remote.failed && !remote.data ? (
        <Notice tone="error" action={<Button onClick={remote.reload}>{t('group.feed.retry')}</Button>}>
          {t('group.board.error')}
        </Notice>
      ) : remote.loading && !remote.data ? (
        <div className="bd-feed__loading" role="status">
          <Spinner size="lg" label={null} />
        </div>
      ) : ranked.length === 0 ? (
        <EmptyState title={t('group.board.nobody')} />
      ) : (
        <>
          {podium.length > 0 ? (
            <ol className="bd-podium" data-testid="podium">
              {podiumOrder.map((row, index) =>
                row ? (
                  <li
                    key={row.userId}
                    className={`bd-podium__item bd-podium__item--${row.rank}${row.userId === membership.userId ? ' is-me' : ''}`}
                    data-rank={row.rank}
                    data-user-id={row.userId}
                  >
                    <Link
                      to={groupMemberPath(row.userId)}
                      aria-label={`${t('group.board.rank', { rank: row.rank })}: ${row.nickname}, ${boardValueText(board, row.value)}`}
                    >
                      <Avatar nickname={row.nickname} color={row.color} size="lg" />
                      <span className="bd-podium__rank">{row.rank}</span>
                      <span className="bd-podium__nick">{row.nickname}</span>
                      <strong className="bd-podium__value">{boardValueText(board, row.value)}</strong>
                      {speciesLine(row) ? <small>{speciesLine(row)}</small> : null}
                    </Link>
                  </li>
                ) : (
                  <li key={`gap-${index}`} className="bd-podium__item bd-podium__item--gap" aria-hidden="true" />
                ),
              )}
            </ol>
          ) : null}
          <ol className="bd-board__list" start={podium.length + 1}>
            {rest.map((row) => (
              <li
                key={row.userId}
                className={row.userId === membership.userId ? 'bd-board__row is-me' : 'bd-board__row'}
                data-testid="board-row"
                data-rank={row.rank}
                data-user-id={row.userId}
                data-value={row.value}
              >
                <Link to={groupMemberPath(row.userId)} aria-label={`${t('group.board.openMember')}: ${row.nickname}`}>
                  <span className="bd-board__rank">{row.value > 0 ? row.rank : '–'}</span>
                  <Avatar nickname={row.nickname} color={row.color} size="sm" />
                  <span className="bd-board__nick">
                    {row.nickname}
                    {row.userId === membership.userId ? <em> ({t('group.board.you')})</em> : null}
                  </span>
                  <span className="bd-board__value">{boardValueText(board, row.value)}</span>
                </Link>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}
