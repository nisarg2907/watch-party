import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { 
  extractVideoId, 
  ClientToServerEvents, 
  ServerToClientEvents,
  SessionState,
  PlayEventPayload,
  PauseEventPayload,
  SeekEventPayload,
  ChangeVideoPayload
} from '@watchparty/shared'

const app = express()

// Simple request logger so we can see where traffic is coming from
app.use((req, _res, next) => {
  const origin = req.headers.origin
  const host = req.headers.host
  console.log(
    '[HTTP]',
    req.method,
    req.url,
    'origin=',
    origin ?? 'n/a',
    'host=',
    host ?? 'n/a',
  )
  next()
})

const httpServer = createServer(app)
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
  },
})

const PORT = process.env.PORT || 4000

// In-memory session state (single-instance server)
// SessionState is now imported from @watchparty/shared

let sessionState: SessionState = {
  videoId: '',
  playbackTime: 0,
  isPlaying: false,
  lastAction: 'init',
  lastActionBy: 'system',
  seq: 0,
  lastUpdatedAt: Date.now(),
}

// Compute the current authoritative playback time based on last update
const getAuthoritativeTime = (): number => {
  if (!sessionState.isPlaying) {
    return sessionState.playbackTime
  }

  const now = Date.now()
  const deltaSeconds = (now - sessionState.lastUpdatedAt) / 1000
  return sessionState.playbackTime + deltaSeconds
}

// Helper to update in-memory session state
const updateSessionState = (update: Partial<SessionState>) => {
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

io.on('connection', (socket) => {
  const origin = socket.handshake.headers.origin
  const referer = socket.handshake.headers.referer
  console.log(
    '[SOCKET] connected',
    { id: socket.id, origin: origin ?? 'n/a', referer: referer ?? 'n/a' },
  )

  // Send current session state to newly connected client
  socket.emit('session:init', {
    ...sessionState,
    playbackTime: getAuthoritativeTime(),
  })

  socket.on('session:play', (data: PlayEventPayload) => {
    const clientId = socket.id.substring(0, 8)
    console.log('[EVENT] play from', clientId, 'time=', data.time)
    // Use client's time as a hint, but state will re-derive from server clock
    updateSessionState({
      isPlaying: true,
      playbackTime: data.time,
      lastAction: 'play',
      lastActionBy: clientId,
    })
    const time = getAuthoritativeTime()
    console.log('[BROADCAST] play time=', time, 'seq=', sessionState.seq)
    io.emit('session:play', {
      time,
      seq: sessionState.seq,
      lastUpdatedAt: sessionState.lastUpdatedAt,
    })
  })

  socket.on('session:pause', (data: PauseEventPayload) => {
    const clientId = socket.id.substring(0, 8)
    console.log('[EVENT] pause from', clientId, 'time=', data.time)
    updateSessionState({
      isPlaying: false,
      playbackTime: data.time,
      lastAction: 'pause',
      lastActionBy: clientId,
    })
    const time = getAuthoritativeTime()
    console.log('[BROADCAST] pause time=', time, 'seq=', sessionState.seq)
    io.emit('session:pause', {
      time,
      seq: sessionState.seq,
      lastUpdatedAt: sessionState.lastUpdatedAt,
    })
  })

  socket.on('session:seek', (data: SeekEventPayload) => {
    const clientId = socket.id.substring(0, 8)
    console.log('[EVENT] seek from', clientId, 'time=', data.time)
    updateSessionState({
      playbackTime: data.time,
      lastAction: 'seek',
      lastActionBy: clientId,
    })
    const time = getAuthoritativeTime()
    console.log('[BROADCAST] seek time=', time, 'seq=', sessionState.seq)
    io.emit('session:seek', {
      time,
      seq: sessionState.seq,
      lastUpdatedAt: sessionState.lastUpdatedAt,
    })
  })

  socket.on('session:changeVideo', (data: ChangeVideoPayload) => {
    const videoId = extractVideoId(data.videoId) || data.videoId
    if (videoId) {
      const clientId = socket.id.substring(0, 8)
      console.log('[EVENT] changeVideo from', clientId, 'videoId=', videoId)
      updateSessionState({
        videoId,
        playbackTime: 0,
        isPlaying: false,
        lastAction: 'changeVideo',
        lastActionBy: clientId,
      })
      console.log('[BROADCAST] videoChange videoId=', videoId, 'seq=', sessionState.seq)
      io.emit('session:videoChange', {
        videoId,
        seq: sessionState.seq,
        lastUpdatedAt: sessionState.lastUpdatedAt,
      })
    }
  })

  socket.on('disconnect', () => {
    console.log('[SOCKET] disconnected', socket.id)
  })
})

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

