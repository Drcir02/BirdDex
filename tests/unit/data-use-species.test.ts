// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Species } from '../../src/domain/types'
import { getLoadedSpecies, resetSpeciesCache } from '../../src/data/species'
import { useSpecies } from '../../src/data/useSpecies'

const TIT: Species = {
  id: 'parus-major', dexNumber: 1, scientificName: 'Parus major', czechName: 'Sýkora koňadra', englishName: 'Great Tit', family: 'Paridae',
  inCzechia: true, inEurope: true, rarity: 'common', birdnetIndex: 4237, wingclipIndex: 7082, wikiTitle: 'Great tit',
}

afterEach(() => {
  cleanup()
  resetSpeciesCache()
  vi.unstubAllGlobals()
})

describe('useSpecies', () => {
  it('starts empty, then gives the list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([TIT]), { status: 200 })))
    const { result } = renderHook(() => useSpecies())
    expect(result.current.species).toBeUndefined()
    expect(result.current.error).toBeUndefined()
    await waitFor(() => expect(result.current.species).toHaveLength(1))
    expect(result.current.species?.[0].id).toBe('parus-major')
    expect(getLoadedSpecies()).toBe(result.current.species)
  })

  it('has the list at once when it was loaded before', () => {
    resetSpeciesCache([TIT])
    const { result } = renderHook(() => useSpecies())
    expect(result.current.species).toEqual([TIT])
  })

  it('reports a failure and tries again on retry', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockImplementation(async () => new Response(JSON.stringify([TIT]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useSpecies())
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error))
    expect(result.current.species).toBeUndefined()
    act(() => result.current.retry())
    expect(result.current.error).toBeUndefined()
    await waitFor(() => expect(result.current.species).toHaveLength(1))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
