import { useId } from 'react'
import { t } from '../../i18n'
import { cx } from '../../ui/logic'
import { MEMBER_COLORS } from './colors'
import './group.css'

export const NICKNAME_MAX = 24

/** The nickname and the colour of a member: the same fields when joining, creating and editing. */
export function ProfileFields({
  nickname,
  color,
  onNickname,
  onColor,
  hint = true,
}: {
  nickname: string
  color: string
  onNickname: (value: string) => void
  onColor: (value: string) => void
  hint?: boolean
}) {
  const id = useId()
  return (
    <>
      <div className="bd-field">
        <label htmlFor={`${id}-nick`} className="bd-field__label">
          {t('group.join.nicknameLabel')}
        </label>
        <input
          id={`${id}-nick`}
          className="bd-field__input"
          type="text"
          value={nickname}
          maxLength={NICKNAME_MAX}
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="done"
          onChange={(event) => onNickname(event.target.value)}
          data-testid="nickname-input"
        />
        {hint ? <p className="bd-field__hint">{t('group.join.nicknameHint')}</p> : null}
      </div>
      <div className="bd-field" role="radiogroup" aria-label={t('group.join.colorLabel')}>
        <span className="bd-field__label" aria-hidden="true">
          {t('group.join.colorLabel')}
        </span>
        <div className="bd-colors">
          {MEMBER_COLORS.map((value, index) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={value.toLowerCase() === color.toLowerCase()}
              aria-label={t('group.join.colorOption', { n: index + 1 })}
              className={cx('bd-colors__item', value.toLowerCase() === color.toLowerCase() && 'is-selected')}
              style={{ background: value }}
              onClick={() => onColor(value)}
              data-testid={`color-${index + 1}`}
            />
          ))}
        </div>
      </div>
    </>
  )
}
