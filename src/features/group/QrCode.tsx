import { useEffect, useState } from 'react'
import { t } from '../../i18n'

/** A QR code of a text, drawn as an SVG. The small library that makes it is loaded only when one is shown. */
export function QrCode({ text, size = 200 }: { text: string; size?: number }) {
  const [svg, setSvg] = useState<string | undefined>()
  useEffect(() => {
    let alive = true
    import('qrcode-generator')
      .then(({ default: qrcode }) => {
        const code = qrcode(0, 'M')
        code.addData(text)
        code.make()
        if (alive) setSvg(code.createSvgTag({ scalable: true, margin: 2 }))
      })
      .catch(() => {
        if (alive) setSvg(undefined)
      })
    return () => {
      alive = false
    }
  }, [text])
  if (!svg) return <div className="bd-qr bd-qr--empty" style={{ width: size, height: size }} aria-hidden="true" />
  return (
    <div
      className="bd-qr"
      style={{ width: size, height: size }}
      role="img"
      aria-label={t('group.invite.qr')}
      data-testid="invite-qr"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
