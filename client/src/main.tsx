import { createRoot } from 'react-dom/client'
import App from './App'
import AdminPanel from './pages/AdminPanel'
import MobileTracker from './pages/MobileTracker'

const page = new URLSearchParams(window.location.search).get('page')

let Component = App
if (page === 'admin') Component = AdminPanel
else if (page === 'mobile') Component = MobileTracker

// StrictMode MapLibre bilan mos kelmaydi (double-mount muammo)
createRoot(document.getElementById('root')!).render(<Component />)
