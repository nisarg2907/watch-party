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
} as const

/**
 * Session state interface
 */
export interface SessionState {
  videoId: string
  playbackTime: number
  isPlaying: boolean
  lastAction: string
  lastActionBy: string
  seq: number
}

