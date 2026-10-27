// Which group server the app talks to: the real one (Supabase), or the fake one in memory when "birddex:groupServer" is "fake"
// (in the address as ?groupServer=fake, or in localStorage). Tests can also hand in their own with useGroupApiForTests.

import { readChoice } from '../../ml/engines'
import type { GroupApi } from './types'

let override: GroupApi | undefined
let instance: Promise<GroupApi> | undefined

export function getGroupApi(): Promise<GroupApi> {
  if (override) return Promise.resolve(override)
  instance ??=
    readChoice('groupServer') === 'fake'
      ? import('./fakeApi').then(({ createFakeApi }) => createFakeApi({ delayMs: Number(readChoice('groupDelay')) || 0 }))
      : import('./supabaseApi').then(({ createSupabaseApi }) => createSupabaseApi())
  return instance
}

/** For tests: use this server from now on (nothing: the choice from the address again). */
export function useGroupApiForTests(api?: GroupApi): void {
  override = api
  instance = undefined
}
