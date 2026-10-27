import { beforeEach, describe, expect, it } from 'vitest'
import { FAKE_FOUNDER_CODE, FAKE_GROUP_CODE, createFakeApi, type FakeGroupApi } from '../../src/features/group/fakeApi'
import { GroupError, type PostInput } from '../../src/features/group/types'

// The fake server follows the rules of the real one, so the screens and the outbox can be tested without a network.

let now = Date.UTC(2026, 8, 16, 10)
let api: FakeGroupApi
const kindOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise
    return 'no error'
  } catch (error) {
    return error instanceof GroupError ? error.kind : 'other'
  }
}
const input = (id: string, extra: Partial<PostInput> = {}): PostInput => ({
  catchId: id,
  speciesId: 'parus-major',
  method: 'live',
  confidence: 0.9,
  caughtAt: now - 1000,
  bp: 300,
  bpRange: [50, 500],
  ...extra,
})

beforeEach(() => {
  now = Date.UTC(2026, 8, 16, 10)
  api = createFakeApi({ userId: 'me', persist: false, now: () => now })
})

describe('joining', () => {
  it('joins with the code in any spelling, and then reads the group', async () => {
    const joined = await api.joinGroup({ code: 'rodina-23', nickname: 'Míša', color: '#1971C2' })
    expect(joined.groupName).toBe('Rodina')
    const members = await api.members(joined.groupId)
    expect(members.map((member) => member.nickname)).toEqual(['Tomáš', 'Anna', 'Jirka', 'Míša'])
  })

  it('refuses a wrong code, a name that is taken (also in other letters) and a nickname that is empty', async () => {
    expect(await kindOf(api.joinGroup({ code: 'NOPE2345', nickname: 'Míša', color: '#1971C2' }))).toBe('no-group')
    expect(await kindOf(api.joinGroup({ code: FAKE_GROUP_CODE, nickname: ' anna ', color: '#1971C2' }))).toBe('name-taken')
    expect(await kindOf(api.joinGroup({ code: FAKE_GROUP_CODE, nickname: '   ', color: '#1971C2' }))).toBe('rejected')
  })

  it('reads nothing of a group it is not in', async () => {
    const group = (await api.createGroup({ founderCode: FAKE_FOUNDER_CODE, name: 'Jiná', nickname: 'Já', color: '#1971C2' })).groupId
    void group
    expect(await kindOf(api.as('stranger').feed('fake-group-rodina'))).toBe('removed')
  })
})

describe('making a group', () => {
  it('needs the founder code, makes an 8 character code and makes the maker the admin', async () => {
    expect(await kindOf(api.createGroup({ founderCode: 'wrong', name: 'Nová', nickname: 'Já', color: '#1971C2' }))).toBe('wrong-founder-code')
    const made = await api.createGroup({ founderCode: ` ${FAKE_FOUNDER_CODE.toLowerCase()} `, name: ' Nová ', nickname: 'Já', color: '#1971C2' })
    expect(made.groupName).toBe('Nová')
    expect(made.code).toMatch(/^[A-Z2-9]{8}$/)
    expect((await api.members(made.groupId))[0]).toMatchObject({ nickname: 'Já', isAdmin: true })
  })
})

describe('posting', () => {
  let groupId: string
  beforeEach(async () => {
    groupId = (await api.joinGroup({ code: FAKE_GROUP_CODE, nickname: 'Míša', color: '#1971C2' })).groupId
  })

  it('posts a catch once, even when it is sent twice', async () => {
    const first = await api.publish(groupId, input('c1'))
    const second = await api.publish(groupId, input('c1'))
    expect(second.postId).toBe(first.postId)
    expect((await api.feed(groupId)).filter((post) => post.userId === 'me')).toHaveLength(1)
  })

  it('refuses a BP outside the range and a date far from today', async () => {
    expect(await kindOf(api.publish(groupId, input('c2', { bp: 900 })))).toBe('rejected')
    expect(await kindOf(api.publish(groupId, input('c3', { caughtAt: now + 3 * 86_400_000 })))).toBe('rejected')
    expect(await kindOf(api.publish(groupId, input('c4', { caughtAt: now - 400 * 86_400_000 })))).toBe('rejected')
  })

  it('shows the new post on top, with the member who made it, and takes it away again', async () => {
    now += 1000
    const { postId } = await api.publish(groupId, input('c5'))
    const [top] = await api.feed(groupId)
    expect(top).toMatchObject({ id: postId, nickname: 'Míša', catchId: 'c5' })
    await api.deletePost(groupId, postId)
    expect((await api.feed(groupId)).some((post) => post.id === postId)).toBe(false)
  })

  it('lets a member delete only their own posts, but the admin any', async () => {
    const someoneElses = (await api.feed(groupId))[0]
    expect(await kindOf(api.deletePost(groupId, someoneElses.id))).toBe('rejected')
    await api.as('fake-tomas').deletePost('fake-group-rodina', someoneElses.id)
    expect((await api.feed(groupId)).some((post) => post.id === someoneElses.id)).toBe(false)
  })

  it('gives and takes back a Super', async () => {
    const [post] = await api.feed(groupId)
    await api.react(post.id, true)
    await api.react(post.id, true)
    expect((await api.feed(groupId))[0]).toMatchObject({ reactions: post.reactions + 1, iReacted: true })
    await api.react(post.id, false)
    expect((await api.feed(groupId))[0]).toMatchObject({ reactions: post.reactions, iReacted: false })
  })

  it('tells about the newest post of somebody else (and not of me)', async () => {
    const before = await api.latest(groupId)
    now += 5000
    await api.publish(groupId, input('c6'))
    expect(await api.latest(groupId)).toBe(before)
    api.addPostBy('fake-anna', 'parus-major')
    expect(await api.latest(groupId)).toBe(now)
  })

  it('gives addresses for the pictures it has', async () => {
    const urls = await api.mediaUrls(['seed/anna-upupa.svg', 'nothing'])
    expect(Object.keys(urls)).toEqual(['seed/anna-upupa.svg'])
    expect(urls['seed/anna-upupa.svg']).toMatch(/^data:image\/svg\+xml/)
  })
})

describe('leaving and being removed', () => {
  it('takes the posts of the member along when they leave', async () => {
    const groupId = (await api.joinGroup({ code: FAKE_GROUP_CODE, nickname: 'Míša', color: '#1971C2' })).groupId
    await api.publish(groupId, input('c7'))
    await api.leaveGroup(groupId)
    expect(api.snapshot().posts.some((post) => post.userId === 'me')).toBe(false)
    expect(api.snapshot().members.some((member) => member.userId === 'me')).toBe(false)
  })

  it('lets only the admin remove somebody, and hands the key on when the admin leaves', async () => {
    const groupId = (await api.joinGroup({ code: FAKE_GROUP_CODE, nickname: 'Míša', color: '#1971C2' })).groupId
    expect(await kindOf(api.removeMember(groupId, 'fake-anna'))).toBe('rejected')
    const admin = api.as('fake-tomas')
    await admin.removeMember(groupId, 'fake-anna')
    expect((await admin.members(groupId)).some((member) => member.userId === 'fake-anna')).toBe(false)
    await admin.leaveGroup(groupId)
    expect(api.snapshot().members.find((member) => member.isAdmin)?.userId).toBe('fake-jirka')
  })

  it('says the phone was removed when a removed member asks for something', async () => {
    const groupId = (await api.joinGroup({ code: FAKE_GROUP_CODE, nickname: 'Míša', color: '#1971C2' })).groupId
    await api.as('fake-tomas').removeMember(groupId, 'me')
    expect(await kindOf(api.publish(groupId, input('c8')))).toBe('removed')
  })
})

describe('without a connection', () => {
  it('fails with "network" for everything until it is back', async () => {
    const groupId = (await api.joinGroup({ code: FAKE_GROUP_CODE, nickname: 'Míša', color: '#1971C2' })).groupId
    api.online = false
    expect(await kindOf(api.feed(groupId))).toBe('network')
    expect(await kindOf(api.publish(groupId, input('c9')))).toBe('network')
    api.online = true
    expect(await kindOf(api.feed(groupId))).toBe('no error')
  })
})
