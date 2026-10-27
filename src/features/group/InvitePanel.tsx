import { useState } from 'react'
import { APP_NAME } from '../../app/constants'
import { t } from '../../i18n'
import { Button, LcdPanel } from '../../ui'
import { useToast } from '../../ui/Toast'
import { QrCode } from './QrCode'
import { inviteLink } from './state'
import './group.css'

/** The code of a group, its link and QR code: what a member shows or sends to invite somebody. */
export function InvitePanel({ code, groupName }: { code: string; groupName?: string }) {
  const toast = useToast()
  const link = inviteLink(code)
  const [showQr, setShowQr] = useState(false)
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      toast.show(t('group.invite.copied'), { tone: 'success' })
    } catch {
      toast.show(t('group.invite.copyFailed'), { tone: 'error' })
    }
  }
  const share = async () => {
    try {
      await navigator.share({ title: groupName ?? APP_NAME, text: t('group.invite.shareText', { code }), url: link })
    } catch {
      // The person closed the sheet.
    }
  }

  return (
    <LcdPanel title={t('group.invite.title')} titleLevel={3} className="bd-invite" data-testid="invite-panel">
      <p className="bd-invite__label">{t('group.invite.code')}</p>
      <p className="bd-invite__code" data-testid="invite-code">
        {code}
      </p>
      <div className="bd-invite__buttons">
        {canShare ? (
          <Button icon="upload" onClick={() => void share()} data-testid="invite-share">
            {t('group.invite.share')}
          </Button>
        ) : null}
        <Button variant="secondary" icon="download" onClick={() => void copy()} data-testid="invite-copy">
          {t('group.invite.copy')}
        </Button>
        <Button variant="secondary" icon="info" onClick={() => setShowQr((value) => !value)} aria-expanded={showQr} data-testid="invite-qr-toggle">
          {t('group.invite.qr')}
        </Button>
      </div>
      {showQr ? (
        <div className="bd-invite__qr">
          <QrCode text={link} size={220} />
          <p className="bd-field__hint">{t('group.invite.qrHint')}</p>
        </div>
      ) : null}
    </LcdPanel>
  )
}
