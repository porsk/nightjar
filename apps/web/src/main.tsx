import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { registerSW } from 'virtual:pwa-register'
import './i18n/index.ts'
import './styles.css'
import './voice.css'
import { App } from './app.tsx'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

registerSW({ immediate: true })

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, networkMode: 'always' } },
})

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
