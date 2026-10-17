import type { ReactNode } from 'react'
import { t } from '../i18n'
import { LcdPanel } from '../ui/LcdPanel'
import { Page, PageHeader } from '../ui/Page'
import './StubPage.css'

interface StubPageProps {
  title: string
  backTo?: string
  /** Links to the other screens, so every screen can be reached by tapping while the real ones are built. */
  children?: ReactNode
}

/** Placeholder for a screen that another task replaces. It shows the Czech title and a few links. */
export function StubPage({ title, backTo, children }: StubPageProps) {
  return (
    <Page>
      <PageHeader title={title} backTo={backTo} />
      <LcdPanel>
        <p>{t('common.underConstruction')}</p>
        {children ? <div className="bd-stub__links">{children}</div> : null}
      </LcdPanel>
    </Page>
  )
}
