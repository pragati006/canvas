import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { BrowserRouter, MemoryRouter, Route, Routes } from 'react-router-dom'
import { CreateSessionPage } from './pages/CreateSessionPage'
import { DashboardPage } from './pages/DashboardPage'
import { InterviewPage } from './pages/InterviewPage'
import { LobbyPage } from './pages/LobbyPage'
import { LoginPage } from './pages/LoginPage'
import { VerifyPage } from './pages/VerifyPage'
import { getInterviewService } from './services'
import { ServiceProvider } from './services/ServiceContext'
import type { InterviewService } from './services/api'

interface Toast {
  id: string
  message: string
  tone: 'info' | 'warn'
}

const ToastContext = createContext<(message: string, tone?: Toast['tone']) => void>(() => undefined)

export function useToast() {
  return useContext(ToastContext)
}

function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = crypto.randomUUID()
    setToasts((current) => [...current, { id, message, tone }])
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id))
    }, 4200)
  }, [])
  const value = useMemo(() => push, [push])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`} role="status">
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/verify" element={<VerifyPage />} />
      <Route path="/join/:token" element={<LobbyPage />} />
      <Route path="/" element={<DashboardPage />} />
      <Route path="/sessions/new" element={<CreateSessionPage />} />
      <Route path="/sessions/:sessionId" element={<InterviewPage />} />
      <Route path="*" element={<LoginPage />} />
    </Routes>
  )
}

export function App({
  service,
  initialPath,
}: {
  service?: InterviewService
  initialPath?: string
}) {
  const resolved = service ?? getInterviewService()
  const content = (
    <ServiceProvider service={resolved}>
      <ToastProvider>
        <AppRoutes />
      </ToastProvider>
    </ServiceProvider>
  )
  if (initialPath) return <MemoryRouter initialEntries={[initialPath]}>{content}</MemoryRouter>
  return <BrowserRouter>{content}</BrowserRouter>
}
