// What each sensitivity level means, in numbers taken from the catch rules (so the text can never disagree with the rules).

import { catchRule } from '../../domain/thresholds'
import type { Sensitivity } from '../../domain/types'
import { formatPercent } from '../../i18n'

export const SENSITIVITY_LEVELS: readonly Sensitivity[] = ['strict', 'normal', 'easy']

export interface SensitivityNumbers {
  sound: string
  photo: string
}

/** The minimum confidence for each way of scanning, as written in the UI ("70 %"). */
export function sensitivityNumbers(level: Sensitivity): SensitivityNumbers {
  return {
    sound: formatPercent(catchRule('sound', level).minConfidence),
    photo: formatPercent(catchRule('photo', level).minConfidence),
  }
}

export function isSensitivity(value: unknown): value is Sensitivity {
  return value === 'strict' || value === 'normal' || value === 'easy'
}
