// The app's database (IndexedDB through Dexie). Three tables:
//   catches     every confirmed catch (CatchRecord)
//   media       the photo or audio clip saved with a catch (MediaRecord, the blob lives here)
//   photoCache  reference photos looked up on Wikipedia, with their credits, so they also show offline
//
// The schema is a list of versions. To change it, never edit an old entry: append a new one with the changed
// tables (and an `upgrade` function when existing rows have to be converted).

import Dexie, { type DexieOptions, type Table, type Transaction } from 'dexie'
import type { CatchRecord, MediaRecord } from '../domain/types'

export const DB_NAME = 'birddex'

/** A reference photo of a species, found on Wikipedia, with what the app must show as credit. */
export interface PhotoCacheRecord {
  speciesId: string
  /** Address of the small picture. An empty string means "looked it up, there is no photo". */
  thumbnailUrl: string
  author: string
  /** Name of the licence, for example "CC BY-SA 4.0". */
  licence: string
  /** Page of the photo, where the credit and the licence text live. */
  link: string
  /** Milliseconds since 1970. Old entries can be looked up again. */
  fetchedAt: number
  /** The small picture itself, when it was saved for offline use. */
  thumbnail?: Blob
}

export interface SchemaVersion {
  version: number
  /** Dexie store definitions: only the tables that change in this version. `null` drops a table. */
  stores: Record<string, string | null>
  /** Converts existing rows. Runs inside the upgrade transaction. */
  upgrade?: (transaction: Transaction) => void | PromiseLike<void>
}

export const SCHEMA_VERSIONS: readonly SchemaVersion[] = [
  {
    version: 1,
    stores: {
      // [speciesId+caughtAt] lists the catches of one species newest first. mediaId finds the catches that share a clip.
      catches: 'id, speciesId, caughtAt, [speciesId+caughtAt], mediaId',
      media: 'id, createdAt',
      photoCache: 'speciesId, fetchedAt',
    },
  },
]

export class BirdDexDatabase extends Dexie {
  declare catches: Table<CatchRecord, string>
  declare media: Table<MediaRecord, string>
  declare photoCache: Table<PhotoCacheRecord, string>

  constructor(name: string = DB_NAME, versions: readonly SchemaVersion[] = SCHEMA_VERSIONS, options?: DexieOptions) {
    super(name, options)
    for (const { version, stores, upgrade } of [...versions].sort((a, b) => a.version - b.version)) {
      const definition = this.version(version).stores(stores)
      if (upgrade) definition.upgrade(upgrade)
    }
  }
}

let instance: BirdDexDatabase | undefined

/** The one database of the app. Created on first use, so importing this module never touches IndexedDB. */
export function getDb(): BirdDexDatabase {
  instance ??= new BirdDexDatabase()
  return instance
}

/** Closes the connection. The next use opens it again. */
export function closeDb(): void {
  instance?.close()
  instance = undefined
}
