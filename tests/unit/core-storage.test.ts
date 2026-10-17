import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getStorageUsage, isQuotaExceededError, requestPersistentStorage, resetPersistentStorageRequest } from '../../src/state/storage'

describe('isQuotaExceededError', () => {
  it('recognises the errors browsers use for a full disk', () => {
    expect(isQuotaExceededError(new DOMException('full', 'QuotaExceededError'))).toBe(true)
    expect(isQuotaExceededError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true)
    expect(isQuotaExceededError({ name: 'Error', code: 22 })).toBe(true)
    expect(isQuotaExceededError({ code: 1014 })).toBe(true)
  })

  it('looks inside wrapped errors', () => {
    const inner = new DOMException('full', 'QuotaExceededError')
    expect(isQuotaExceededError(Object.assign(new Error('transaction aborted'), { inner }))).toBe(true)
    expect(isQuotaExceededError(new Error('failed', { cause: inner }))).toBe(true)
    expect(isQuotaExceededError(new Error('failed', { cause: new Error('deeper', { cause: inner }) }))).toBe(true)
  })

  it('says no to everything else, and survives odd input', () => {
    expect(isQuotaExceededError(new Error('network down'))).toBe(false)
    expect(isQuotaExceededError(new DOMException('x', 'NotFoundError'))).toBe(false)
    expect(isQuotaExceededError(undefined)).toBe(false)
    expect(isQuotaExceededError(null)).toBe(false)
    expect(isQuotaExceededError('QuotaExceededError')).toBe(false)
    expect(isQuotaExceededError(22)).toBe(false)
    const loop: { cause?: unknown } = {}
    loop.cause = loop
    expect(isQuotaExceededError(loop)).toBe(false)
  })
})

describe('requestPersistentStorage', () => {
  beforeEach(() => resetPersistentStorageRequest())
  afterEach(() => vi.unstubAllGlobals())

  const stubStorage = (storage: Partial<StorageManager> | undefined) => vi.stubGlobal('navigator', { storage })

  it('is false where the browser cannot do it', async () => {
    stubStorage(undefined)
    expect(await requestPersistentStorage()).toBe(false)
    stubStorage({})
    expect(await requestPersistentStorage()).toBe(false)
    vi.stubGlobal('navigator', undefined)
    expect(await requestPersistentStorage()).toBe(false)
  })

  it('does not get stuck on an early "no": a later call asks again', async () => {
    stubStorage({})
    expect(await requestPersistentStorage()).toBe(false)
    stubStorage({ persisted: async () => false, persist: async () => true })
    expect(await requestPersistentStorage()).toBe(true)
  })

  it('does not ask again when storage is already protected', async () => {
    const persist = vi.fn(async () => true)
    stubStorage({ persisted: async () => true, persist })
    expect(await requestPersistentStorage()).toBe(true)
    expect(persist).not.toHaveBeenCalled()
  })

  it('asks the browser, and remembers a yes', async () => {
    const persist = vi.fn(async () => true)
    stubStorage({ persisted: async () => false, persist })
    expect(await requestPersistentStorage()).toBe(true)
    expect(await requestPersistentStorage()).toBe(true)
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('does not remember a no, because browsers say yes more readily later', async () => {
    const persist = vi.fn(async () => false)
    stubStorage({ persisted: async () => false, persist })
    expect(await requestPersistentStorage()).toBe(false)
    expect(await requestPersistentStorage()).toBe(false)
    expect(persist).toHaveBeenCalledTimes(2)
  })

  it('shares one question between callers who ask at the same time', async () => {
    const persist = vi.fn(async () => true)
    stubStorage({ persisted: async () => false, persist })
    const answers = await Promise.all([requestPersistentStorage(), requestPersistentStorage(), requestPersistentStorage()])
    expect(answers).toEqual([true, true, true])
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('never throws', async () => {
    stubStorage({
      persist: async () => {
        throw new Error('blocked')
      },
    })
    expect(await requestPersistentStorage()).toBe(false)
  })
})

describe('getStorageUsage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('tells how much is used, how much is allowed, and whether it is protected', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage: 91_000_000, quota: 4_000_000_000 }), persisted: async () => true } })
    expect(await getStorageUsage()).toEqual({ usedBytes: 91_000_000, quotaBytes: 4_000_000_000, persistent: true })
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage: 1, quota: 2 }) } })
    expect(await getStorageUsage()).toEqual({ usedBytes: 1, quotaBytes: 2, persistent: false })
  })

  it('is undefined where the browser cannot say, and never throws', async () => {
    vi.stubGlobal('navigator', {})
    expect(await getStorageUsage()).toBeUndefined()
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({}) } })
    expect(await getStorageUsage()).toBeUndefined()
    vi.stubGlobal('navigator', {
      storage: {
        estimate: async () => {
          throw new Error('denied')
        },
      },
    })
    expect(await getStorageUsage()).toBeUndefined()
    vi.stubGlobal('navigator', undefined)
    expect(await getStorageUsage()).toBeUndefined()
  })
})
