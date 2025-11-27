import { Socket, Server } from 'socket.io'
import {
  extractVideoId,
  ClientToServerEvents,
  ServerToClientEvents,
  SocketEvents,
  JoinEventPayload,
  PlayEventPayload,
  PauseEventPayload,
  SeekEventPayload,
  ChangeVideoPayload,
  User,
} from '@watchparty/shared'
import {
  getAuthoritativeTime,
  updateSessionState,
  getSessionState,
  addUser,
  removeUser,
} from '../session/state'
import { setUser, getUser, deleteUser } from '../session/users'

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>

/**
 * Handle ping for latency measurement
 */
export const handlePing = (socket: TypedSocket): void => {
  socket.on('ping', () => {
    socket.emit('pong')
  })
}

/**
 * Handle user join
 */
export const handleJoin = (socket: TypedSocket): void => {
  socket.on(SocketEvents.JOIN, (data: JoinEventPayload) => {
    // Validate and sanitize username
    const rawUsername = (data.username || 'Anonymous')
      .trim()
      .slice(0, 50) // Max length 50 characters
      .replace(/[<>]/g, '') // Basic XSS prevention - remove angle brackets

    const username = rawUsername || 'Anonymous' // Fallback if sanitization results in empty string

    if (!username || username.length === 0) {
      console.warn('[USER] Invalid username rejected from', socket.id)
      return
    }

    const user: User = {
      socketId: socket.id,
      username: username,
      joinedAt: Date.now(),
    }

    setUser(socket.id, username)
    addUser(socket.id, username)

    console.log(`[USER] ${username} joined`, socket.id)

    // Send immediate sync state to the joining user with current authoritative time
    const currentTime = getAuthoritativeTime()
    socket.emit(SocketEvents.INIT, {
      ...getSessionState(),
      playbackTime: currentTime,
    })

    console.log(`[SYNC] sent current time ${currentTime} to new joiner ${data.username}`)

    // Broadcast to all OTHER clients that a user joined
    socket.broadcast.emit(SocketEvents.USER_JOINED, { user })
  })
}

/**
 * Handle play event
 */
export const handlePlay = (socket: TypedSocket, io: TypedServer): void => {
  socket.on(SocketEvents.PLAY, (data: PlayEventPayload) => {
    const username = getUser(socket.id) || 'Unknown'
    const clientId = socket.id.substring(0, 8)
    console.log('[EVENT] play from', username, clientId, 'time=', data.time)
    
    // Use client's time as a hint, but state will re-derive from server clock
    updateSessionState({
      isPlaying: true,
      playbackTime: data.time,
      lastAction: 'play',
      lastActionBy: clientId,
      lastActionByUsername: username,
    })
    
    const sessionState = getSessionState()
    const time = getAuthoritativeTime()
    console.log('[BROADCAST] play time=', time, 'seq=', sessionState.seq)
    
    io.emit(SocketEvents.PLAY_BROADCAST, {
      time,
      seq: sessionState.seq,
      lastUpdatedAt: sessionState.lastUpdatedAt,
      username,
    })
  })
}

/**
 * Handle pause event
 */
export const handlePause = (socket: TypedSocket, io: TypedServer): void => {
  socket.on(SocketEvents.PAUSE, (data: PauseEventPayload) => {
    const username = getUser(socket.id) || 'Unknown'
    const clientId = socket.id.substring(0, 8)
    console.log('[EVENT] pause from', username, clientId, 'time=', data.time)
    
    updateSessionState({
      isPlaying: false,
      playbackTime: data.time,
      lastAction: 'pause',
      lastActionBy: clientId,
      lastActionByUsername: username,
    })
    
    const sessionState = getSessionState()
    const time = getAuthoritativeTime()
    console.log('[BROADCAST] pause time=', time, 'seq=', sessionState.seq)
    
    io.emit(SocketEvents.PAUSE_BROADCAST, {
      time,
      seq: sessionState.seq,
      lastUpdatedAt: sessionState.lastUpdatedAt,
      username,
    })
  })
}

/**
 * Handle seek event
 */
export const handleSeek = (socket: TypedSocket, io: TypedServer): void => {
  socket.on(SocketEvents.SEEK, (data: SeekEventPayload) => {
    const username = getUser(socket.id) || 'Unknown'
    const clientId = socket.id.substring(0, 8)
    console.log('[EVENT] seek from', username, clientId, 'time=', data.time)
    
    updateSessionState({
      playbackTime: data.time,
      lastAction: 'seek',
      lastActionBy: clientId,
      lastActionByUsername: username,
    })
    
    const sessionState = getSessionState()
    const time = getAuthoritativeTime()
    console.log('[BROADCAST] seek time=', time, 'seq=', sessionState.seq)
    
    io.emit(SocketEvents.SEEK_BROADCAST, {
      time,
      seq: sessionState.seq,
      lastUpdatedAt: sessionState.lastUpdatedAt,
      username,
    })
  })
}

/**
 * Handle video change event
 */
export const handleVideoChange = (socket: TypedSocket, io: TypedServer): void => {
  socket.on(SocketEvents.CHANGE_VIDEO, (data: ChangeVideoPayload) => {
    const videoId = extractVideoId(data.videoId)

    // Validate video ID: must be exactly 11 characters and alphanumeric with hyphens/underscores
    if (!videoId || videoId.length !== 11 || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      const username = getUser(socket.id) || 'Unknown'
      console.warn('[EVENT] Invalid video ID rejected from', username, ':', data.videoId)
      return // Silently reject invalid video IDs
    }

    const username = getUser(socket.id) || 'Unknown'
    const clientId = socket.id.substring(0, 8)
    console.log('[EVENT] changeVideo from', username, clientId, 'videoId=', videoId)
    
    updateSessionState({
      videoId,
      playbackTime: 0,
      isPlaying: false,
      lastAction: 'changeVideo',
      lastActionBy: clientId,
      lastActionByUsername: username,
    })
    
    const sessionState = getSessionState()
    console.log('[BROADCAST] videoChange videoId=', videoId, 'seq=', sessionState.seq)
    
    io.emit(SocketEvents.VIDEO_CHANGE, {
      videoId,
      seq: sessionState.seq,
      lastUpdatedAt: sessionState.lastUpdatedAt,
      username,
    })
  })
}

/**
 * Handle disconnect event
 */
export const handleDisconnect = (socket: TypedSocket, io: TypedServer): void => {
  socket.on('disconnect', () => {
    const username = getUser(socket.id) || 'Unknown'
    console.log('[USER] disconnected', username, socket.id)

    // Remove user from state
    removeUser(socket.id)
    deleteUser(socket.id)

    // Broadcast to all clients that user left
    io.emit(SocketEvents.USER_LEFT, {
      socketId: socket.id,
      username,
    })
  })
}

/**
 * Register all socket handlers
 */
export const registerSocketHandlers = (socket: TypedSocket, io: TypedServer): void => {
  handlePing(socket)
  handleJoin(socket,)
  handlePlay(socket, io)
  handlePause(socket, io)
  handleSeek(socket, io)
  handleVideoChange(socket, io)
  handleDisconnect(socket, io)
}
