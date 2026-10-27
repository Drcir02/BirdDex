// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  GROUP_KEY,
  addPostToDelete,
  clearMembership,
  dismissRemoved,
  getGroupState,
  getMembership,
  inviteLink,
  reloadGroupStateForTests,
  removePostToDelete,
  sanitizeGroupState,
  setMembership,
  updateMembership,
  updatePrefs,
  type Membership,
} from '../../src/features/group/state'

const MEMBERSHIP: Membership = {
  groupId: 'g1',
  groupName: 'Rodina',
  code: 'RODINA23',
  nickname: 'Míša',
  color: '#1971C2',
  userId: 'u1',
  isAdmin: false,
  joinedAt: 1_700_000_000_000,
}

beforeEach(() => {
  localStorage.clear()
  reloadGroupStateForTests()
})

describe('what the phone knows about its group', () => {
  it('starts with no group and sharing on, with the place shown exactly', () => {
    const state = getGroupState()
    expect(state.membership).toBeUndefined()
    expect(state.prefs).toEqual({ autoShare: true, place: 'exact', seenAt: 0 })
    expect(state.deletes).toEqual([])
  })

  it('keeps a membership across a reload', () => {
    setMembership(MEMBERSHIP)
    reloadGroupStateForTests()
    expect(getMembership()).toEqual(MEMBERSHIP)
  })

  it('drops a broken membership and a broken preference, and keeps what is fine', () => {
    const state = sanitizeGroupState({
      membership: { ...MEMBERSHIP, userId: '' },
      prefs: { autoShare: 'yes', place: 'galaxy', seenAt: 5 },
      deletes: [{ groupId: 'g', postId: 'p' }, { groupId: 'g' }, 'x'],
    })
    expect(state.membership).toBeUndefined()
    expect(state.prefs).toEqual({ autoShare: true, place: 'exact', seenAt: 5 })
    expect(state.deletes).toEqual([{ groupId: 'g', postId: 'p' }])
    expect(sanitizeGroupState('rubbish').prefs.autoShare).toBe(true)
  })

  it('changes the nickname and the colour, and the preferences', () => {
    setMembership(MEMBERSHIP)
    updateMembership({ nickname: 'Míša2', color: '#E8590C' })
    expect(getMembership()).toMatchObject({ nickname: 'Míša2', color: '#E8590C' })
    expect(updatePrefs({ place: 'none', autoShare: false }).place).toBe('none')
    expect(getGroupState().prefs.autoShare).toBe(false)
  })

  it('leaving forgets the group but keeps the preferences, and says why when the admin removed the phone', () => {
    setMembership(MEMBERSHIP)
    updatePrefs({ place: 'name' })
    addPostToDelete({ groupId: 'g1', postId: 'p1' })
    clearMembership('Rodina')
    expect(getMembership()).toBeUndefined()
    expect(getGroupState().prefs.place).toBe('name')
    expect(getGroupState().deletes).toEqual([])
    expect(getGroupState().removedFrom).toBe('Rodina')
    dismissRemoved()
    expect(getGroupState().removedFrom).toBeUndefined()
  })

  it('joining a group clears the message about the old one', () => {
    clearMembership('Stará')
    expect(getGroupState().removedFrom).toBe('Stará')
    setMembership(MEMBERSHIP)
    expect(getGroupState().removedFrom).toBeUndefined()
  })

  it('remembers posts to delete once', () => {
    addPostToDelete({ groupId: 'g', postId: 'p' })
    addPostToDelete({ groupId: 'g', postId: 'p' })
    expect(getGroupState().deletes).toHaveLength(1)
    removePostToDelete('p')
    expect(getGroupState().deletes).toHaveLength(0)
  })

  it('survives storage that cannot be read', () => {
    localStorage.setItem(GROUP_KEY, '{broken')
    reloadGroupStateForTests()
    expect(getGroupState().membership).toBeUndefined()
  })
})

describe('the invitation link', () => {
  it('opens the join screen with the code in it', () => {
    expect(inviteLink('RODINA23', 'https://drcir02.github.io', '/BirdDex/')).toBe('https://drcir02.github.io/BirdDex/#/group/join/RODINA23')
  })
})
