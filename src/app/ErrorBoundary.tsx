import { Component, type ErrorInfo, type ReactNode } from 'react'
import { t } from '../i18n'
import { Button } from '../ui/Button'
import { cx } from '../ui/logic'
import { SpeciesSilhouette } from '../ui/SpeciesSilhouette'
import './ErrorBoundary.css'

export type ErrorKind = 'chunk' | 'generic'

/**
 * A screen's code is downloaded the first time it opens. If that fails (no network, or a new version replaced the files)
 * the message should say so instead of blaming the app.
 */
export function classifyError(error: unknown): ErrorKind {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /dynamically imported module|importing a module script failed|loading chunk|chunkloaderror|error loading dynamically/i.test(text) ? 'chunk' : 'generic'
}

export interface ErrorScreenProps {
  error: Error
  /** app fills the whole window (used outside the device shell); screen sits inside the LCD. */
  variant?: 'app' | 'screen'
  /** Forgets the error and shows the app again from the start. */
  onHome?: () => void
}

/** The calm screen shown when something breaks: what happened, that nothing is lost, and what to do next. */
export function ErrorScreen({ error, variant = 'screen', onHome }: ErrorScreenProps) {
  const kind = classifyError(error)
  return (
    <div className={cx('bd-errorscreen', variant === 'app' && 'bd-errorscreen--app bd-text')} role="alert">
      <div className="bd-errorscreen__box">
        <SpeciesSilhouette size={80} />
        <h1 className="bd-errorscreen__title">{t('common.errorScreen.title')}</h1>
        <p>{kind === 'chunk' ? t('common.errors.chunk') : t('common.errorScreen.message')}</p>
        <div className="bd-errorscreen__actions">
          <Button onClick={() => window.location.reload()}>{t('common.errorScreen.reload')}</Button>
          {onHome ? (
            <Button variant="secondary" onClick={onHome}>
              {t('common.errorScreen.home')}
            </Button>
          ) : null}
        </div>
        <details className="bd-errorscreen__details">
          <summary>{t('common.errorScreen.details')}</summary>
          <pre>{`${error.name}: ${error.message}`}</pre>
        </details>
      </div>
    </div>
  )
}

interface ErrorBoundaryProps {
  children: ReactNode
  variant?: 'app' | 'screen'
  /** When this value changes the boundary tries again. The shell passes the current path, so leaving a broken screen heals it. */
  resetKey?: string
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('A screen broke:', error, info.componentStack)
  }

  componentDidUpdate(previous: ErrorBoundaryProps): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  private goHome = (): void => {
    window.location.hash = '#/'
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return <ErrorScreen error={error} variant={this.props.variant} onHome={this.goHome} />
  }
}
