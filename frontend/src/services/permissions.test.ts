import { describe, expect, it } from 'vitest'
import type { Role, SessionState } from './domain'
import { can, type Capability } from './permissions'

const roles: Role[] = ['owner', 'interviewer', 'candidate', 'observer']

function allow(state: SessionState, editing: boolean) {
  return (role: Role, capability: Capability) => can(role, capability, { state, candidateEditingEnabled: editing })
}

describe('permissions', () => {
  it('matches the interview permission matrix', () => {
    const live = allow('live', true)
    expect(roles.every((role) => live(role, 'view_canvas'))).toBe(true)
    expect(live('owner', 'edit_canvas')).toBe(true)
    expect(live('interviewer', 'edit_canvas')).toBe(true)
    expect(live('candidate', 'edit_canvas')).toBe(true)
    expect(live('observer', 'edit_canvas')).toBe(false)
    expect(live('owner', 'end_session')).toBe(true)
    expect(live('interviewer', 'end_session')).toBe(false)
    expect(live('candidate', 'revoke_link')).toBe(false)
    expect(live('owner', 'lock_editing')).toBe(true)
    expect(live('interviewer', 'remove_participant')).toBe(false)

    const locked = allow('live', false)
    expect(locked('candidate', 'edit_canvas')).toBe(false)
    expect(locked('owner', 'edit_canvas')).toBe(true)

    const ended = allow('ended', true)
    expect(ended('owner', 'view_ended')).toBe(true)
    expect(ended('interviewer', 'view_canvas')).toBe(true)
    expect(ended('observer', 'view_canvas')).toBe(true)
    expect(ended('candidate', 'view_canvas')).toBe(false)
    expect(roles.every((role) => ended(role, 'edit_canvas') === false)).toBe(true)
  })
})
