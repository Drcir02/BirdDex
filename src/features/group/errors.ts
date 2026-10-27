import { t } from '../../i18n'
import { GroupError } from './types'

/** The words for a failed join or create. */
export function joinErrorText(error: unknown): string {
  if (error instanceof GroupError) {
    switch (error.kind) {
      case 'no-group':
        return t('group.join.errors.noGroup')
      case 'name-taken':
        return t('group.join.errors.nameTaken')
      case 'full':
        return t('group.join.errors.full')
      case 'wrong-founder-code':
        return t('group.create.errors.wrongFounder')
      case 'network':
        return t('group.join.errors.network')
    }
  }
  return t('group.join.errors.other')
}

/** The code as it is saved: capitals and digits only (a pasted code may carry spaces or dashes). */
export const normalizeCode = (value: string): string => value.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
