/**
 * Extract YouTube video ID from various URL formats
 */
export function extractVideoId(url: string): string | null {
  if (!url) return null

  // Handle direct video ID
  if (url.length === 11 && /^[a-zA-Z0-9_-]{11}$/.test(url)) {
    return url
  }

  // Handle various YouTube URL formats
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/watch\?.*&v=([a-zA-Z0-9_-]{11})/,
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match && match[1]) {
      return match[1]
    }
  }

  return null
}

/**
 * Socket event names
 *
 * Centralised to keep client and server in sync.
 */
export const SocketEvents = {
  // Client -> Server
  PLAY: 'session:play',
  PAUSE: 'session:pause',
  SEEK: 'session:seek',
  CHANGE_VIDEO: 'session:changeVideo',

  // Server -> Client
  INIT: 'session:init',
  PLAY_BROADCAST: 'session:play',
  PAUSE_BROADCAST: 'session:pause',
  SEEK_BROADCAST: 'session:seek',
  VIDEO_CHANGE: 'session:videoChange',
  UPDATE: 'session:update',
} as const

/**
 * Session state interface
 *
 * This is the canonical shape of a watch-party session. Both the server and
 * client use this type so their view of state stays in sync.
 */
export interface SessionState {
  videoId: string
  /**
   * Last authoritative playback time in seconds.
   * On the server, this is updated whenever we receive a client event.
   * On the client, it's a snapshot of what the server last told us.
   */
  playbackTime: number
  isPlaying: boolean
  lastAction: string
  lastActionBy: string
  /**
   * Monotonic sequence number for debugging / ordering.
   * Increments on every server-side state update.
   */
  seq: number
  /**
   * When this state was last updated on the server (ms since epoch).
   * Used for more advanced clock-synchronization if needed.
   */
  lastUpdatedAt: number
}

/**
 * A logical session identifier.
 *
 * We currently use a single global session, but this makes it easy to move to
 * multi-room (roomId === sessionId) later.
 */
export type SessionId = string

/**
 * Client -> Server event payloads for the single-session model.
 */
export interface SessionPlayPayload {
  time: number
}

export interface SessionPausePayload {
  time: number
}

export interface SessionSeekPayload {
  time: number
}

export interface SessionChangeVideoPayload {
  /**
   * Raw YouTube URL or video id provided by the client.
   * The server normalizes this via `extractVideoId`.
   */
  videoId: string
}

/**
 * Server -> Client broadcast payloads.
 */
export interface SessionPlayBroadcast {
  time: number
  seq: number
  lastUpdatedAt: number
}

export interface SessionPauseBroadcast {
  time: number
  seq: number
  lastUpdatedAt: number
}

export interface SessionSeekBroadcast {
  time: number
  seq: number
  lastUpdatedAt: number
}

export interface SessionVideoChangeBroadcast {
  videoId: string
  seq: number
  lastUpdatedAt: number
}

/**
 * Periodic full-session broadcast (heartbeat or cross-instance update).
 * Currently just aliases the canonical SessionState shape.
 */
export type SessionUpdateBroadcast = SessionState

