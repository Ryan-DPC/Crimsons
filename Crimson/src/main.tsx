import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { LCUProvider } from './contexts/LCUContext.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LCUProvider>
        <App />
    </LCUProvider>
  </StrictMode>,
)
