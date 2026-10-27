// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { Blob as NodeBlob } from 'node:buffer'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createElement as h, type ReactElement } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSpeciesCache } from '../../src/data/species'
import { addCatch, deleteAllCatches, getCatch } from '../../src/db'
import type { Species } from '../../src/domain/types'
import { useGroupApiForTests } from '../../src/features/group/api'
import { FAKE_FOUNDER_CODE, FAKE_GROUP_CODE, createFakeApi, type FakeGroupApi } from '../../src/features/group/fakeApi'
import { GroupSection } from '../../src/features/group/GroupSection'
import { EraseSection } from '../../src/features/settings/EraseSection'
import { ShareControl } from '../../src/features/group/ShareControl'
import { SHARE_DELAY_MS, flushShares, initialShare } from '../../src/features/group/share'
import { getMembership, reloadGroupStateForTests, setMembership, updatePrefs } from '../../src/features/group/state'
import { reloadSettingsForTests } from '../../src/state/settings'
import { ToastProvider, ToastViewport } from '../../src/ui/Toast'

// The reference photos come from Wikipedia: not in these tests.
vi.mock('../../src/features/photos', () => ({ useReferencePhoto: () => ({ photo: undefined, status: 'none' }) }))

import GroupCreatePage from '../../src/pages/GroupCreatePage'
import GroupJoinPage from '../../src/pages/GroupJoinPage'
import GroupMemberPage from '../../src/pages/GroupMemberPage'
import GroupPage from '../../src/pages/GroupPage'

beforeAll(() => {
  vi.stubGlobal('Blob', NodeBlob)
})

const bird = (id: string, czechName: string, rarity: Species['rarity'] = 'common'): Species => ({
  id,
  dexNumber: 1,
  scientificName: id,
  czechName,
  englishName: id,
  family: null,
  inCzechia: true,
  inEurope: true,
  rarity,
  birdnetIndex: 1,
  wingclipIndex: 1,
  wikiTitle: null,
  info: { months: '333333333333', place: 'woods', shy: 1, day: 'day', tip: 'smallwoods', bp: [50, 600] },
})
const LIST: Species[] = [
  bird('parus-major', 'Sýkora koňadra'),
  bird('turdus-merula', 'Kos černý'),
  bird('erithacus-rubecula', 'Červenka obecná'),
  bird('upupa-epops', 'Dudek chocholatý', 'uncommon'),
  bird('alcedo-atthis', 'Ledňáček říční'),
  bird('cyanistes-caeruleus', 'Sýkora modřinka'),
]

function Where() {
  const location = useLocation()
  return h('p', { 'data-testid': 'where' }, location.pathname + location.search)
}

function app(path: string): ReactElement {
  return h(
    ToastProvider,
    null,
    h(
      MemoryRouter,
      { initialEntries: [path] },
      h(Where),
      h(ToastViewport),
      h(
        Routes,
        null,
        h(Route, { path: '/group', element: h(GroupPage) }),
        h(Route, { path: '/group/join', element: h(GroupJoinPage) }),
        h(Route, { path: '/group/join/:code', element: h(GroupJoinPage) }),
        h(Route, { path: '/group/create', element: h(GroupCreatePage) }),
        h(Route, { path: '/group/member/:userId', element: h(GroupMemberPage) }),
        h(Route, { path: '/settings', element: h(GroupSection) }),
        h(Route, { path: '*', element: h('p', { 'data-testid': 'elsewhere' }, 'jinde') }),
      ),
    ),
  )
}

let api: FakeGroupApi

function joinAs(nickname = 'Míša') {
  return api.joinGroup({ code: FAKE_GROUP_CODE, nickname, color: '#1971C2' }).then(({ groupId }) => {
    setMembership({
      groupId,
      groupName: 'Rodina',
      code: FAKE_GROUP_CODE,
      nickname,
      color: '#1971C2',
      userId: 'me',
      isAdmin: false,
      joinedAt: Date.now(),
    })
    return groupId
  })
}

beforeEach(async () => {
  window.localStorage.clear()
  reloadGroupStateForTests()
  reloadSettingsForTests()
  resetSpeciesCache(LIST)
  await deleteAllCatches()
  api = createFakeApi({ userId: 'me', persist: false })
  useGroupApiForTests(api)
})

afterEach(async () => {
  cleanup()
  useGroupApiForTests(undefined)
  await deleteAllCatches()
})

describe('the group screen without a group', () => {
  it('invites to join or to create one, and says that nothing is sent before', () => {
    render(app('/group'))
    expect(screen.getByRole('heading', { level: 2, name: 'Zatím v žádné skupině nejsi' })).toBeTruthy()
    expect(screen.getByTestId('none-join')).toBeTruthy()
    expect(screen.getByTestId('none-create')).toBeTruthy()
  })
})

describe('joining', () => {
  it('fills the code from an invitation link, joins and opens the group', async () => {
    render(app(`/group/join/${FAKE_GROUP_CODE}`))
    expect((screen.getByTestId('code-input') as HTMLInputElement).value).toBe(FAKE_GROUP_CODE)
    fireEvent.change(screen.getByTestId('nickname-input'), { target: { value: 'Míša' } })
    fireEvent.click(screen.getByTestId('join-submit'))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/group'))
    expect(getMembership()).toMatchObject({ groupName: 'Rodina', nickname: 'Míša', code: FAKE_GROUP_CODE, userId: 'me', isAdmin: false })
  })

  it('says in plain words what is shared before joining', () => {
    render(app('/group/join'))
    const consent = screen.getByTestId('join-consent')
    expect(consent.textContent).toContain('720 bodů')
    expect(consent.textContent).toContain('Starší úlovky se nesdílejí')
  })

  it('asks for a nickname, and says when the code is wrong or the name is taken', async () => {
    render(app('/group/join'))
    fireEvent.change(screen.getByTestId('code-input'), { target: { value: 'nope2345' } })
    fireEvent.click(screen.getByTestId('join-submit'))
    expect((await screen.findByTestId('join-error')).textContent).toMatch(/přezdívku/)
    fireEvent.change(screen.getByTestId('nickname-input'), { target: { value: 'Míša' } })
    fireEvent.click(screen.getByTestId('join-submit'))
    await waitFor(() => expect(screen.getByTestId('join-error').textContent).toMatch(/Takovou skupinu neznám/))
    fireEvent.change(screen.getByTestId('code-input'), { target: { value: FAKE_GROUP_CODE } })
    fireEvent.change(screen.getByTestId('nickname-input'), { target: { value: 'anna' } })
    fireEvent.click(screen.getByTestId('join-submit'))
    await waitFor(() => expect(screen.getByTestId('join-error').textContent).toMatch(/přezdívku už/))
    expect(getMembership()).toBeUndefined()
  })

  it('says so when the server cannot be reached', async () => {
    api.online = false
    render(app(`/group/join/${FAKE_GROUP_CODE}`))
    fireEvent.change(screen.getByTestId('nickname-input'), { target: { value: 'Míša' } })
    fireEvent.click(screen.getByTestId('join-submit'))
    expect((await screen.findByTestId('join-error')).textContent).toMatch(/spojit se serverem/)
  })

  it('does not join a second group', async () => {
    await joinAs()
    render(app('/group/join'))
    expect(screen.getByTestId('join-already')).toBeTruthy()
  })
})

describe('creating a group', () => {
  it('needs the founder code, then shows the invitation with the code and the QR code', async () => {
    render(app('/group/create'))
    fireEvent.change(screen.getByTestId('founder-input'), { target: { value: 'wrong' } })
    fireEvent.change(screen.getByTestId('group-name-input'), { target: { value: 'Kamarádi' } })
    fireEvent.change(screen.getByTestId('nickname-input'), { target: { value: 'Já' } })
    fireEvent.click(screen.getByTestId('create-submit'))
    expect((await screen.findByTestId('join-error')).textContent).toMatch(/Kód zakladatele nesedí/)

    fireEvent.change(screen.getByTestId('founder-input'), { target: { value: FAKE_FOUNDER_CODE } })
    fireEvent.click(screen.getByTestId('create-submit'))
    expect(await screen.findByTestId('invite-code')).toBeTruthy()
    expect(screen.getByTestId('invite-code').textContent).toMatch(/^[A-Z2-9]{8}$/)
    expect(getMembership()).toMatchObject({ groupName: 'Kamarádi', nickname: 'Já', isAdmin: true })
    fireEvent.click(screen.getByTestId('invite-qr-toggle'))
    await waitFor(() => expect(screen.getByTestId('invite-qr').querySelector('svg')).toBeTruthy())
    fireEvent.click(screen.getByTestId('create-to-group'))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/group'))
  })
})

describe('the feed', () => {
  it('shows the posts newest first, who, where and the BP, with the badges', async () => {
    await joinAs()
    render(app('/group'))
    const posts = await screen.findAllByTestId('feed-post')
    expect(posts).toHaveLength(9)
    // The newest seeded post is Anna's blue tit from 2 hours ago.
    expect(within(posts[0]).getByTestId('post-name').textContent).toContain('Sýkora modřinka')
    expect(within(posts[0]).getByTestId('post-author').textContent).toContain('Anna')
    expect(within(posts[0]).getByTestId('bp-value').textContent).toBe('300')
    expect(within(posts[0]).getByTestId('badge-first')).toBeTruthy()
    // A place with a point links to the map; one with a name only does not.
    const hoopoe = posts.find((post) => post.getAttribute('data-species-id') === 'upupa-epops')!
    expect(within(hoopoe).getByTestId('post-map').getAttribute('href')).toContain('openstreetmap.org/?mlat=48.85550')
    expect(within(posts[0]).queryByTestId('post-map')).toBeNull()
  })

  it('shows the picture of a post when the server gave its address', async () => {
    await joinAs()
    render(app('/group'))
    const posts = await screen.findAllByTestId('feed-post')
    const hoopoe = posts.find((post) => post.getAttribute('data-species-id') === 'upupa-epops')!
    await waitFor(() => expect(within(hoopoe).getByTestId('post-photo').getAttribute('src')).toMatch(/^data:image\/svg/))
  })

  it('gives and takes back a Super with a count', async () => {
    await joinAs()
    render(app('/group'))
    const hoopoe = (await screen.findAllByTestId('feed-post')).find((post) => post.getAttribute('data-species-id') === 'upupa-epops')!
    expect(within(hoopoe).getByTestId('post-reactions').textContent).toBe('2')
    fireEvent.click(within(hoopoe).getByTestId('post-react'))
    await waitFor(() => expect(within(hoopoe).getByTestId('post-reactions').textContent).toBe('3'))
    expect(within(hoopoe).getByTestId('post-react').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(hoopoe).getByTestId('post-react'))
    await waitFor(() => expect(within(hoopoe).getByTestId('post-reactions').textContent).toBe('2'))
    expect(
      (await api.feed((await api.members('fake-group-rodina'))[0] && 'fake-group-rodina')).find((post) => post.speciesId === 'upupa-epops'),
    ).toMatchObject({
      reactions: 2,
      iReacted: false,
    })
  })

  it('opens the details: the five scores and whether the species is in my Dex', async () => {
    await joinAs()
    await addCatch({ speciesId: 'upupa-epops', method: 'live', confidence: 0.9 })
    render(app('/group'))
    const posts = await screen.findAllByTestId('feed-post')
    const hoopoe = posts.find((post) => post.getAttribute('data-species-id') === 'upupa-epops')!
    const kos = posts.find((post) => post.getAttribute('data-species-id') === 'turdus-merula')!
    fireEvent.click(within(hoopoe).getByTestId('post-toggle'))
    await waitFor(() => expect(within(hoopoe).getByTestId('post-mydex').textContent).toMatch(/máš v Dexu/))
    fireEvent.click(within(kos).getByTestId('post-toggle'))
    expect(within(kos).getByTestId('post-mydex').textContent).toMatch(/ještě nemáš/)
  })

  it('filters to the new species and to my own posts', async () => {
    await joinAs()
    render(app('/group'))
    await screen.findAllByTestId('feed-post')
    fireEvent.click(screen.getByTestId('feed-filter-new'))
    await waitFor(() => expect(screen.getAllByTestId('feed-post').length).toBeLessThan(9))
    fireEvent.click(screen.getByTestId('feed-filter-mine'))
    expect(await screen.findByTestId('feed-none')).toBeTruthy()
  })

  it('shows the last feed with a note when there is no connection', async () => {
    await joinAs()
    const first = render(app('/group'))
    await screen.findAllByTestId('feed-post')
    first.unmount()
    api.online = false
    render(app('/group'))
    expect((await screen.findByTestId('feed-offline')).textContent).toMatch(/offline/)
    expect(screen.getAllByTestId('feed-post').length).toBeGreaterThan(0)
  })

  it('lets only the admin delete a post of somebody else', async () => {
    await joinAs()
    render(app('/group'))
    const posts = await screen.findAllByTestId('feed-post')
    fireEvent.click(within(posts[0]).getByTestId('post-toggle'))
    expect(within(posts[0]).queryByTestId('post-delete')).toBeNull()
    cleanup()
    // The same person as admin.
    const { membership } = { membership: getMembership()! }
    setMembership({ ...membership, isAdmin: true })
    api.as('fake-tomas')
    render(app('/group'))
    const again = await screen.findAllByTestId('feed-post')
    fireEvent.click(within(again[0]).getByTestId('post-toggle'))
    expect(within(again[0]).getByTestId('post-delete')).toBeTruthy()
  })
})

describe('the leaderboards', () => {
  it('shows the podium and everybody, my row marked, and switches the board and the period', async () => {
    await joinAs()
    render(app('/group?tab=board'))
    const podium = await screen.findByTestId('podium')
    expect(
      within(podium)
        .getAllByRole('listitem')
        .filter((item) => item.getAttribute('data-rank')),
    ).toHaveLength(3)
    // Tomáš 3 species, Anna 3, Jirka 2 (the ties share first place), me 0.
    expect(podium.querySelector('[data-rank="1"]')).toBeTruthy()
    const mine = screen.getAllByTestId('board-row').find((row) => row.getAttribute('data-user-id') === 'me')!
    expect(mine.className).toContain('is-me')
    expect(mine.textContent).toContain('0 druhů')
    fireEvent.click(screen.getByTestId('board-strongest'))
    await waitFor(() => expect(screen.getByTestId('podium').textContent).toContain('BP 790'))
    fireEvent.click(screen.getByRole('radio', { name: 'Týden' }))
    await waitFor(() => expect(screen.getByTestId('board')).toBeTruthy())
  })
})

describe('the members', () => {
  it('lists them, the admin is marked, and the admin can remove somebody', async () => {
    await joinAs()
    render(app('/group?tab=members'))
    const rows = await screen.findAllByTestId('member-row')
    expect(rows).toHaveLength(4)
    expect(screen.getByTestId('members-count').textContent).toBe('4 členové')
    expect(rows[0].textContent).toContain('správce')
    expect(screen.queryByTestId('member-remove')).toBeNull()
    cleanup()
    setMembership({ ...getMembership()!, isAdmin: true })
    api.as('me')
    render(app('/group?tab=members'))
    expect((await screen.findAllByTestId('member-remove')).length).toBeGreaterThan(0)
  })

  it('opens the page of a member with their numbers and strongest birds', async () => {
    await joinAs()
    render(app('/group/member/fake-tomas'))
    expect((await screen.findByTestId('member-nick')).textContent).toBe('Tomáš')
    await waitFor(() => expect(screen.getByTestId('member-catches').textContent).toBe('4'))
    expect(screen.getByTestId('member-species').textContent).toBe('3 z 6')
    expect(screen.getByTestId('member-strongest').textContent).toBe('BP 560')
    const top = screen.getByTestId('member-top')
    expect(top.querySelectorAll('li')).toHaveLength(4)
    expect(screen.getAllByTestId('feed-post')).toHaveLength(4)
  })

  it('says when the member is no longer in the group', async () => {
    await joinAs()
    render(app('/group/member/nobody'))
    expect(await screen.findByRole('heading', { name: 'Tenhle člen už ve skupině není.' })).toBeTruthy()
  })
})

describe('the group in the settings', () => {
  it('offers to join or create when there is no group', () => {
    render(app('/settings'))
    expect(screen.getByTestId('group-join-link')).toBeTruthy()
    expect(screen.getByTestId('group-create-link')).toBeTruthy()
  })

  it('shows the group, the invitation and the sharing settings, and saves them', async () => {
    await joinAs()
    render(app('/settings'))
    expect(screen.getByTestId('group-name').textContent).toBe('Rodina')
    expect(screen.getByTestId('invite-code').textContent).toBe(FAKE_GROUP_CODE)
    const auto = screen.getByRole('switch', { name: /Sdílet nové úlovky automaticky/ })
    expect(auto.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(auto)
    expect(auto.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('radio', { name: 'Jen název' }))
    expect(screen.getByTestId('group-place-hint').textContent).toMatch(/jen název místa/)
  })

  it('changes the nickname on the server and on the phone, and refuses a name that is taken', async () => {
    await joinAs()
    render(app('/settings'))
    fireEvent.click(screen.getByTestId('group-profile-edit'))
    fireEvent.change(screen.getByTestId('nickname-input'), { target: { value: 'Anna' } })
    fireEvent.click(screen.getByTestId('group-profile-save'))
    expect((await screen.findByTestId('group-error')).textContent).toMatch(/přezdívku už/)
    fireEvent.change(screen.getByTestId('nickname-input'), { target: { value: 'Míša 2' } })
    fireEvent.click(screen.getByTestId('group-profile-save'))
    await waitFor(() => expect(getMembership()!.nickname).toBe('Míša 2'))
    expect((await api.members(getMembership()!.groupId)).some((member) => member.nickname === 'Míša 2')).toBe(true)
  })

  it('leaves the group after a question, and the birds stay', async () => {
    await joinAs()
    await addCatch({ id: 'c1', speciesId: 'parus-major', method: 'live', confidence: 0.9, share: initialShare() })
    render(app('/settings'))
    fireEvent.click(screen.getByTestId('group-leave'))
    expect(screen.getByRole('alertdialog', { hidden: true }) ?? screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Odejít a smazat příspěvky' }))
    await waitFor(() => expect(getMembership()).toBeUndefined())
    expect((await getCatch('c1'))!.shareState).toBeUndefined()
    expect(screen.getByTestId('group-join-link')).toBeTruthy()
  })
})

describe('the share switches of a bird', () => {
  it('show nothing without a group, and nothing for a bird from before joining', async () => {
    await addCatch({ id: 'c0', speciesId: 'parus-major', method: 'live', confidence: 0.9 })
    const first = render(h(ToastProvider, null, h(ShareControl, { catchId: 'c0' })))
    expect(screen.queryByTestId('share-control')).toBeNull()
    first.unmount()
    await joinAs()
    render(h(ToastProvider, null, h(ShareControl, { catchId: 'c0' })))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByTestId('share-control')).toBeNull()
  })

  it('hides and shares a new bird, and hides its place', async () => {
    await joinAs()
    await addCatch({ id: 'c1', speciesId: 'parus-major', method: 'live', confidence: 0.9, placeName: 'Praha', share: initialShare() })
    render(h(ToastProvider, null, h(ShareControl, { catchId: 'c1' })))
    const control = await screen.findByTestId('share-control')
    expect(control.getAttribute('data-share-state')).toBe('pending')
    const share = within(control).getByRole('switch', { name: /Sdílet se skupinou/ })
    expect(share.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(control).getByRole('switch', { name: /Ukázat místo/ }))
    await waitFor(async () => expect((await getCatch('c1'))!.sharePlace).toBe('none'))
    fireEvent.click(share)
    await waitFor(() => expect(screen.getByTestId('share-control').getAttribute('data-share-state')).toBe('hidden'))
    expect(within(screen.getByTestId('share-control')).queryByRole('switch', { name: /Ukázat místo/ })).toBeNull()
    fireEvent.click(within(screen.getByTestId('share-control')).getByRole('switch', { name: /Sdílet se skupinou/ }))
    await waitFor(() => expect(screen.getByTestId('share-control').getAttribute('data-share-state')).toBe('pending'))
    updatePrefs({ autoShare: true })
    await flushShares(Date.now() + 60_000)
    expect(screen.getByTestId('share-control')).toBeTruthy()
  })

  it('switches the several birds of one recording together', async () => {
    await joinAs()
    await addCatch({ id: 'a', speciesId: 'parus-major', method: 'sound', confidence: 0.9, share: initialShare() })
    await addCatch({ id: 'b', speciesId: 'turdus-merula', method: 'sound', confidence: 0.9, share: initialShare() })
    render(h(ToastProvider, null, h(ShareControl, { catchIds: ['a', 'b'] })))
    const control = await screen.findByTestId('share-control')
    fireEvent.click(within(control).getByRole('switch', { name: /Sdílet se skupinou/ }))
    await waitFor(async () => {
      expect((await getCatch('a'))!.shareState).toBe('hidden')
      expect((await getCatch('b'))!.shareState).toBe('hidden')
    })
  })
})

describe('erasing everything', () => {
  it('takes the posts of the group away with the birds and says so, and stays in the group', async () => {
    await joinAs()
    await addCatch({ id: 'c1', speciesId: 'parus-major', method: 'live', confidence: 0.9, share: initialShare() })
    await flushShares(Date.now() + SHARE_DELAY_MS + 1)
    expect((await api.feed((await api.members('fake-group-rodina'))[0] && 'fake-group-rodina')).filter((post) => post.userId === 'me')).toHaveLength(1)
    render(h(ToastProvider, null, h(EraseSection)))
    fireEvent.click(screen.getByTestId('erase-start'))
    expect(screen.getByTestId('erase-group-note').textContent).toMatch(/příspěvky ve skupině se smažou/i)
    fireEvent.click(screen.getByRole('button', { name: 'Pokračovat' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ano, smazat vše' }))
    await waitFor(async () => expect(await getCatch('c1')).toBeUndefined())
    await flushShares(Date.now() + 1000)
    await waitFor(async () => expect(api.snapshot().posts.some((post) => post.userId === 'me')).toBe(false))
    expect(getMembership()).toBeDefined()
  })
})
