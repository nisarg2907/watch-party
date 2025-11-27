import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { ClientToServerEvents, ServerToClientEvents, SocketEvents } from '@watchparty/shared'
import { getAuthoritativeTime, getSessionState } from './session/state'
import { registerSocketHandlers } from './handlers/socket-handlers'

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

// Periodic sync heartbeat - broadcasts current time every 1 second for tighter sync
setInterval(() => {
  const sessionState = getSessionState()
  if (sessionState.isPlaying && sessionState.videoId) {
    const currentTime = getAuthoritativeTime()
    io.emit(SocketEvents.SYNC, {
      time: currentTime,
      seq: sessionState.seq,
      lastUpdatedAt: sessionState.lastUpdatedAt,
    })
  }
}, 1000)

io.on('connection', (socket) => {
  const origin = socket.handshake.headers.origin
  const referer = socket.handshake.headers.referer
  console.log(
    '[SOCKET] connected',
    { id: socket.id, origin: origin ?? 'n/a', referer: referer ?? 'n/a' },
  )

  // Send current session state to newly connected client (without username yet)
  socket.emit(SocketEvents.INIT, {
    ...getSessionState(),
    playbackTime: getAuthoritativeTime(),
  })

  // Register all socket event handlers
  registerSocketHandlers(socket, io)
})

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

