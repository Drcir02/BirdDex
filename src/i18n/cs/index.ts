// Merges the Czech texts. Each file in this folder is one feature; its file name becomes the key prefix,
// so `dex.title` lives in dex.ts as `title`. Files may nest objects (`common.nav.dex`), but only strings are leaves.

import { about } from './about'
import { common } from './common'
import { dex } from './dex'
import { fun } from './fun'
import { onboarding } from './onboarding'
import { result } from './result'
import { scan } from './scan'
import { settings } from './settings'

export const cs = { common, dex, scan, result, settings, about, fun, onboarding } as const
