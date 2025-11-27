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
 */
export const SocketEvents = {
  // Client -> Server
  JOIN: 'session:join',
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
  USER_JOINED: 'session:userJoined',
  USER_LEFT: 'session:userLeft',
} as const

export type SocketEventName = typeof SocketEvents[keyof typeof SocketEvents]

/**
 * User in the session
 */
export interface User {
  socketId: string
  username: string
  joinedAt: number
}

/**
 * Session state interface
 */
export interface SessionState {
  videoId: string
  playbackTime: number
  isPlaying: boolean
  lastAction: string
  lastActionBy: string
  lastActionByUsername: string
  seq: number
  lastUpdatedAt: number
  users: Record<string, User>
}

/**
 * Client -> Server event payloads
 */
export interface ClientToServerEvents {
  'session:join': (data: JoinEventPayload) => void
  'session:play': (data: PlayEventPayload) => void
  'session:pause': (data: PauseEventPayload) => void
  'session:seek': (data: SeekEventPayload) => void
  'session:changeVideo': (data: ChangeVideoPayload) => void
}

/**
 * Server -> Client event payloads
 */
export interface ServerToClientEvents {
  'session:init': (data: SessionState) => void
  'session:play': (data: PlayBroadcastPayload) => void
  'session:pause': (data: PauseBroadcastPayload) => void
  'session:seek': (data: SeekBroadcastPayload) => void
  'session:videoChange': (data: VideoChangeBroadcastPayload) => void
  'session:userJoined': (data: UserJoinedPayload) => void
  'session:userLeft': (data: UserLeftPayload) => void
}

/**
 * Event payload types
 */
export interface JoinEventPayload {
  username: string
}

export interface PlayEventPayload {
  time: number
}

export interface PauseEventPayload {
  time: number
}

export interface SeekEventPayload {
  time: number
}

export interface ChangeVideoPayload {
  videoId: string
}

export interface PlayBroadcastPayload {
  time: number
  seq: number
  lastUpdatedAt: number
  username: string
}

export interface PauseBroadcastPayload {
  time: number
  seq: number
  lastUpdatedAt: number
  username: string
}

export interface SeekBroadcastPayload {
  time: number
  seq: number
  lastUpdatedAt: number
  username: string
}

export interface VideoChangeBroadcastPayload {
  videoId: string
  seq: number
  lastUpdatedAt: number
  username: string
}

export interface UserJoinedPayload {
  user: User
}

export interface UserLeftPayload {
  socketId: string
  username: string
}

