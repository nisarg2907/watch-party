import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import Redis from 'ioredis'
import {
  extractVideoId,
  SessionState,
  SocketEvents,
  SessionPlayPayload,
  SessionPausePayload,
  SessionSeekPayload,
  SessionChangeVideoPayload,
  SessionPlayBroadcast,
  SessionPauseBroadcast,
  SessionSeekBroadcast,
  SessionVideoChangeBroadcast,
  SessionUpdateBroadcast,
} from '@watchparty/shared'

// --- Configuration ---

const PORT = process.env.PORT || 4000
const REDIS_URL = process.env.REDIS_URL
const SESSION_KEY = 'watchparty:session'
const SESSION_CHANNEL = 'watchparty:session:update'

// --- Session store (in-memory with optional Redis persistence) ---

let sessionState: SessionState = {
  videoId: '',
  playbackTime: 0,
  isPlaying: false,
  lastAction: 'init',
  lastActionBy: 'system',
  seq: 0,
  lastUpdatedAt: Date.now(),
}

type RedisClients = {
  client: Redis
  publisher: Redis
  subscriber: Redis
}

let redisClients: RedisClients | null = null
let heartbeatTimer: NodeJS.Timeout | null = null

if (REDIS_URL) {
  console.log('[REDIS] Using REDIS_URL', REDIS_URL)
  const client = new Redis(REDIS_URL)
  const publisher = new Redis(REDIS_URL)
  const subscriber = new Redis(REDIS_URL)

  redisClients = { client, publisher, subscriber }

  client.on('error', (err: unknown) => {
    console.error('[REDIS] client error', err)
  })
  publisher.on('error', (err: unknown) => {
    console.error('[REDIS] publisher error', err)
  })
  subscriber.on('error', (err: unknown) => {
    console.error('[REDIS] subscriber error', err)
  })

  // Load any existing session state from Redis on startup
  client
    .get(SESSION_KEY)
    .then((value: string | null) => {
      if (!value) return
      const parsed = JSON.parse(value) as SessionState

      if (
        typeof parsed.lastUpdatedAt !== 'number' ||
        typeof parsed.seq !== 'number'
      ) {
        console.warn('[REDIS] Ignoring malformed session state from Redis', parsed)
        return
      }

      sessionState = parsed
      console.log('[REDIS] Loaded existing session state from Redis')
    })
    .catch((err: unknown) => {
      console.error('[REDIS] Failed to load initial session state', err)
    })

  // Subscribe for external updates (for future multi-instance support)
  subscriber
    .subscribe(SESSION_CHANNEL)
    .then(() => {
      subscriber.on('message', (...args: unknown[]) => {
        const [, message] = args as [string, string]
        try {
          const parsed = JSON.parse(message) as SessionState

          // Ignore messages that are not strictly newer than our local state
          if (parsed.seq <= sessionState.seq) {
            console.log('[REDIS] Ignoring pub/sub message with seq <= local seq', {
              incomingSeq: parsed.seq,
              localSeq: sessionState.seq,
            })
            return
          }

          sessionState = parsed
          console.log('[REDIS] Session state updated from pub/sub seq=', parsed.seq)
          // Broadcast the new state to local sockets
          broadcastFullSessionUpdate()
        } catch (err: unknown) {
          console.error('[REDIS] Failed to parse pub/sub message', err)
        }
      })
    })
    .catch((err: unknown) => {
      console.error('[REDIS] Failed to subscribe to session channel', err)
    })
} else {
  console.log('[REDIS] REDIS_URL not set, using in-memory session only')
}

// --- HTTP + Socket.io server setup ---

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
const io = new Server(httpServer, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
  },
})

// Compute the current authoritative playback time based on last update
const getAuthoritativeTime = (): number => {
  if (!sessionState.isPlaying) {
    return sessionState.playbackTime
  }

  const now = Date.now()
  const deltaSeconds = (now - sessionState.lastUpdatedAt) / 1000
  return sessionState.playbackTime + deltaSeconds
}

// Broadcast the full session state to all connected clients
const broadcastFullSessionUpdate = () => {
  const payload: SessionUpdateBroadcast = {
    ...sessionState,
    playbackTime: getAuthoritativeTime(),
  }
  io.emit(SocketEvents.UPDATE, payload)
}

// Helper to update in-memory session state
const updateSessionState = async (update: Partial<SessionState>) => {
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

  // Persist to Redis and broadcast to other instances if available
  if (redisClients) {
    const payload = JSON.stringify(sessionState)
    try {
      console.log('[REDIS] Persisting session state:', payload)
      const res = await redisClients.client.set(SESSION_KEY, payload)
      console.log('[REDIS] Session state persisted:', res)
    } catch (err: unknown) {
      console.error('[REDIS] Failed to persist session state', err)
    }

    try {
      console.log('[REDIS] Publishing session state to channel:', SESSION_CHANNEL)
      const subscriberCount = await redisClients.publisher.publish(SESSION_CHANNEL, payload)
      console.log(`[REDIS] Published session state to ${subscriberCount} subscriber(s)`)
    } catch (err: unknown) {
      console.error('[REDIS] Failed to publish session state', err)
    }
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
  socket.emit(SocketEvents.INIT, {
    ...sessionState,
    playbackTime: getAuthoritativeTime(),
  })

  socket.on(SocketEvents.PLAY, async (data: SessionPlayPayload) => {
    const clientId = socket.id.substring(0, 8)
    console.log('[EVENT] play from', clientId, 'time=', data.time)
    // Use client's time as a hint, but state will re-derive from server clock
    await updateSessionState({
      isPlaying: true,
      playbackTime: data.time,
      lastAction: 'play',
      lastActionBy: clientId,
    })
    const time = getAuthoritativeTime()
    console.log('[BROADCAST] play time=', time, 'seq=', sessionState.seq)
    const payload: SessionPlayBroadcast = {
      time,
      seq: sessionState.seq,
      lastUpdatedAt: sessionState.lastUpdatedAt,
    }
    io.emit(SocketEvents.PLAY_BROADCAST, payload)
  })

  socket.on(SocketEvents.PAUSE, async (data: SessionPausePayload) => {
    const clientId = socket.id.substring(0, 8)
    console.log('[EVENT] pause from', clientId, 'time=', data.time)
    await updateSessionState({
      isPlaying: false,
      playbackTime: data.time,
      lastAction: 'pause',
      lastActionBy: clientId,
    })
    const time = getAuthoritativeTime()
    console.log('[BROADCAST] pause time=', time, 'seq=', sessionState.seq)
    const payload: SessionPauseBroadcast = {
      time,
      seq: sessionState.seq,
      lastUpdatedAt: sessionState.lastUpdatedAt,
    }
    io.emit(SocketEvents.PAUSE_BROADCAST, payload)
  })

  socket.on(SocketEvents.SEEK, async (data: SessionSeekPayload) => {
    const clientId = socket.id.substring(0, 8)
    console.log('[EVENT] seek from', clientId, 'time=', data.time)
    await updateSessionState({
      playbackTime: data.time,
      lastAction: 'seek',
      lastActionBy: clientId,
    })
    const time = getAuthoritativeTime()
    console.log('[BROADCAST] seek time=', time, 'seq=', sessionState.seq)
    const payload: SessionSeekBroadcast = {
      time,
      seq: sessionState.seq,
      lastUpdatedAt: sessionState.lastUpdatedAt,
    }
    io.emit(SocketEvents.SEEK_BROADCAST, payload)
  })

  // Simple per-socket rate limiter for changeVideo
  const lastChangeVideoBySocket = new Map<string, number>()

  socket.on(SocketEvents.CHANGE_VIDEO, async (data: SessionChangeVideoPayload) => {
    const videoId = extractVideoId(data.videoId) || data.videoId
    if (!videoId) {
      console.warn('[EVENT] changeVideo rejected: invalid videoId from', socket.id)
      return
    }

    const now = Date.now()
    const last = lastChangeVideoBySocket.get(socket.id) ?? 0
    if (now - last < 2000) {
      console.warn('[EVENT] changeVideo rate-limited for', socket.id)
      return
    }
    lastChangeVideoBySocket.set(socket.id, now)

    const clientId = socket.id.substring(0, 8)
    console.log('[EVENT] changeVideo from', clientId, 'videoId=', videoId)
    await updateSessionState({
      videoId,
      playbackTime: 0,
      isPlaying: false,
      lastAction: 'changeVideo',
      lastActionBy: clientId,
    })
    console.log('[BROADCAST] videoChange videoId=', videoId, 'seq=', sessionState.seq)
    const payload: SessionVideoChangeBroadcast = {
      videoId,
      seq: sessionState.seq,
      lastUpdatedAt: sessionState.lastUpdatedAt,
    }
    io.emit(SocketEvents.VIDEO_CHANGE, payload)
  })

  socket.on('disconnect', () => {
    console.log('[SOCKET] disconnected', socket.id)
  })
})

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)

  // Heartbeat: periodically broadcast full session state so idle clients can re-sync
  heartbeatTimer = setInterval(() => {
    console.log('[HEARTBEAT] Broadcasting full session update')
    broadcastFullSessionUpdate()
  }, 8000)
})

// Graceful shutdown
const shutdown = async () => {
  console.log('[SHUTDOWN] Received signal, closing server...')
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
  }

  try {
    await io.close()
    console.log('[SHUTDOWN] socket.io closed')
  } catch (err) {
    console.error('[SHUTDOWN] Error closing socket.io', err)
  }

  if (redisClients) {
    try {
      await redisClients.client.quit()
      await redisClients.publisher.quit()
      await redisClients.subscriber.quit()
      console.log('[SHUTDOWN] Redis clients closed')
    } catch (err: unknown) {
      console.error('[SHUTDOWN] Error closing Redis clients', err)
    }
  }

  httpServer.close(() => {
    console.log('[SHUTDOWN] HTTP server closed')
    process.exit(0)
  })
}

process.on('SIGINT', () => {
  void shutdown()
})

process.on('SIGTERM', () => {
  void shutdown()
})

