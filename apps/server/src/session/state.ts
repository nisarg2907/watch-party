import { SessionState } from '@watchparty/shared'

// In-memory session state (single-instance server)
let sessionState: SessionState = {
  videoId: '',
  playbackTime: 0,
  isPlaying: false,
  lastAction: 'init',
  lastActionBy: 'system',
  lastActionByUsername: 'System',
  seq: 0,
  lastUpdatedAt: Date.now(),
  users: {},
}

/**
 * Compute the current authoritative playback time based on last update
 */
export const getAuthoritativeTime = (): number => {
  if (!sessionState.isPlaying) {
    return sessionState.playbackTime
  }

  const now = Date.now()
  const deltaSeconds = (now - sessionState.lastUpdatedAt) / 1000
  return sessionState.playbackTime + deltaSeconds
}

/**
 * Update session state and increment sequence number
 */
export const updateSessionState = (update: Partial<SessionState>): void => {
  // Use the derived time as the base before applying updates
  const currentTime = getAuthoritativeTime()

  sessionState = {
    ...sessionState,
    ...update,
    // If playbackTime is not explicitly provided, carry forward the derived time
    playbackTime: update.playbackTime ?? currentTime,
    seq: sessionState.seq + 1,
    lastUpdatedAt: Date.now(),
  }

  console.log('[STATE]', {
    ...sessionState,
    playbackTime: getAuthoritativeTime(),
  })
}

/**
 * Get current session state
 */
export const getSessionState = (): SessionState => sessionState

/**
 * Add user to session
 */
export const addUser = (socketId: string, username: string): void => {
  sessionState.users[socketId] = {
    socketId,
    username,
    joinedAt: Date.now(),
  }
}

/**
 * Remove user from session
 */
export const removeUser = (socketId: string): void => {
  delete sessionState.users[socketId]
}
