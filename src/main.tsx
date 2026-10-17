import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { registerUpdates } from './app/registerUpdates'
import { recordOfflineLoad } from './fieldcheck/checks/offline'
// Catches the browser's "install the app" offer early, so the welcome and settings screens can show a real install button.
import './features/settings/installCapture'
import './styles/index.css'

// If the page could start with no network, the offline cache works. The Field check shows this.
recordOfflineLoad()
registerUpdates()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
