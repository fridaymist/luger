import '@fontsource-variable/bricolage-grotesque'
import '@fontsource-variable/figtree'
import { createRoot } from 'react-dom/client'
import App from './App'
import { go } from './lib/state'
import './styles/app.css'
import './styles/screens.css'

document.documentElement.dataset.platform = window.luger.platform
createRoot(document.getElementById('root')!).render(<App />)

if (import.meta.env.DEV) (window as any).__go = (page: string, arg: any) => go(page, arg)
