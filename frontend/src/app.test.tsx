import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from './App'
import { createMockInterviewService } from './services/mockInterviewService'
import { MemoryKv, SharedStore } from './services/sharedStore'
import type { InterviewService } from './services/api'

afterEach(() => cleanup())

function renderAt(service: InterviewService, path: string) {
  return render(<App service={service} initialPath={path} />)
}

async function signIn(user: ReturnType<typeof userEvent.setup>, email = 'ada@lattice.test') {
  await user.type(screen.getByLabelText('Email'), email)
  await user.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))
  await user.click(await screen.findByRole('link', { name: 'Open magic link' }))
  await screen.findByRole('heading', { name: 'Interviews' })
}

describe('Lattice', () => {
  it('signs in, starts a templated interview, and ends it read-only', async () => {
    const user = userEvent.setup()
    const service = createMockInterviewService()
    renderAt(service, '/login')

    await user.type(screen.getByLabelText('Email'), 'a@b')
    await user.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid email address.')

    await user.clear(screen.getByLabelText('Email'))
    await signIn(user)

    await user.click(screen.getAllByRole('link', { name: 'New interview' })[0])
    await user.type(screen.getByLabelText('Title'), 'Checkout API')
    await user.click(screen.getByRole('button', { name: /Three-tier web/ }))
    await user.click(screen.getByRole('button', { name: 'Create interview' }))

    expect(await screen.findByLabelText('Session title')).toHaveValue('Checkout API')
    expect(await screen.findByTestId('design-canvas')).toBeInTheDocument()
    expect(screen.getByTestId('connection-status')).toHaveTextContent('Connected')
    expect(screen.getAllByText('API gateway').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Interview timer')).toHaveTextContent('Not started')

    await user.click(screen.getByRole('button', { name: 'API gateway' }))
    expect(screen.getByLabelText('X')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(await screen.findByLabelText('Interview timer')).not.toHaveTextContent('Not started')

    await user.click(screen.getByRole('button', { name: 'Share' }))
    await user.click(screen.getByRole('button', { name: 'Create candidate link' }))
    expect(await screen.findByRole('button', { name: 'Copy link' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'End' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText('This interview has ended. The canvas is read-only.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pen' })).toBeDisabled()
    expect(screen.getByRole('heading', { name: 'Checkout API' })).toBeInTheDocument()
  })

  it('keeps the prompt hidden until a guest joins, then honors a lock', async () => {
    const user = userEvent.setup()
    const store = new SharedStore()
    const owner = createMockInterviewService({
      store,
      userStore: new MemoryKv(),
      guestStore: new MemoryKv(),
      vaultStore: new MemoryKv(),
    })
    const guest = createMockInterviewService({
      store,
      userStore: new MemoryKv(),
      guestStore: new MemoryKv(),
      vaultStore: new MemoryKv(),
    })
    const issued = await owner.requestMagicLink('ada@lattice.test')
    const token = new URL(issued.verificationPath, 'http://localhost').searchParams.get('token')
    if (!token) throw new Error('missing magic token')
    await owner.completeMagicLink(token)
    const session = await owner.createSession({
      title: 'Checkout',
      prompt: 'Sketch the checkout flow.',
    })
    const link = await owner.createGuestLink(session.id)

    renderAt(guest, link.path)
    expect(await screen.findByRole('heading', { name: 'Checkout' })).toBeInTheDocument()
    expect(screen.queryByText('Sketch the checkout flow.')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Display name'), 'Casey')
    await user.click(screen.getByRole('checkbox', { name: /canvas activity/ }))
    await user.click(screen.getByRole('button', { name: 'Join interview' }))

    expect(await screen.findByTestId('design-canvas')).toBeInTheDocument()
    expect(screen.getByText('Sketch the checkout flow.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /People/ }))
    expect(await screen.findByText(/Active/)).toBeInTheDocument()

    await owner.setCandidateEditing(session.id, false)
    expect(await screen.findByText('The interviewer has locked candidate editing.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pen' })).toBeDisabled()
  })

  it('rejects an unknown guest link', async () => {
    const guest = createMockInterviewService()
    renderAt(guest, '/join/not-a-real-token')
    expect(await screen.findByRole('alert')).toHaveTextContent('This link is not valid')
  })
})
