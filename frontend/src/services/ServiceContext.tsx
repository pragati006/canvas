import { createContext, useContext, type ReactNode } from 'react'
import type { InterviewService } from './api'

const ServiceContext = createContext<InterviewService | null>(null)

export function ServiceProvider({ service, children }: { service: InterviewService; children: ReactNode }) {
  return <ServiceContext.Provider value={service}>{children}</ServiceContext.Provider>
}

export function useInterviewService() {
  const service = useContext(ServiceContext)
  if (!service) throw new Error('Interview service is unavailable.')
  return service
}
