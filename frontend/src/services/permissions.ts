import type { Role, SessionState } from './domain'

export type Capability =
  | 'view_canvas'
  | 'edit_canvas'
  | 'invite'
  | 'lock_editing'
  | 'remove_participant'
  | 'end_session'
  | 'revoke_link'
  | 'view_ended'
  | 'archive'
  | 'duplicate'
  | 'clear_canvas'
  | 'restore_snapshot'
  | 'update_session'
  | 'start_session'
  | 'export'

export function can(
  role: Role,
  capability: Capability,
  session: { state: SessionState; candidateEditingEnabled: boolean },
): boolean {
  const closed = session.state === 'ended' || session.state === 'archived'
  switch (capability) {
    case 'view_canvas':
    case 'view_ended':
    case 'export':
      return closed ? role !== 'candidate' : true
    case 'edit_canvas':
      if (closed || role === 'observer') return false
      if (role === 'candidate') return session.candidateEditingEnabled
      return role === 'owner' || role === 'interviewer'
    case 'clear_canvas':
    case 'restore_snapshot':
    case 'update_session':
      return role === 'owner' && !closed
    case 'start_session':
      return role === 'owner' && session.state === 'draft'
    case 'invite':
    case 'lock_editing':
    case 'remove_participant':
    case 'end_session':
    case 'revoke_link':
    case 'archive':
    case 'duplicate':
      return role === 'owner'
    default:
      return false
  }
}
