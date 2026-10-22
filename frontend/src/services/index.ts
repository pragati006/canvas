import type { InterviewService } from './api'
import { HttpInterviewService } from './httpInterviewService'
import { WebKv } from './runtime'

export function createBrowserInterviewService(): InterviewService {
  return new HttpInterviewService({
    userStore: new WebKv(window.localStorage, 'lattice.user.'),
    guestStore: new WebKv(window.sessionStorage, 'lattice.guest.'),
    vaultStore: new WebKv(window.localStorage, 'lattice.vault.'),
  })
}

let browserService: InterviewService | null = null

export function getInterviewService(): InterviewService {
  if (!browserService) browserService = createBrowserInterviewService()
  return browserService
}
