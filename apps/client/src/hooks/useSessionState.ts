import { useEffect, useState, useRef } from 'react'
import { Socket } from 'socket.io-client'
import {
  SocketEvents,
  SessionState,
  PlayBroadcastPayload,
  PauseBroadcastPayload,
  SeekBroadcastPayload,
  VideoChangeBroadcastPayload,
  UserJoinedPayload,
  UserLeftPayload,
  SyncPayload,
} from '@watchparty/shared'

interface UseSessionStateProps {
  socket: Socket | null
  hasJoined: boolean
  playerRef: React.MutableRefObject<YT.Player | null>
  latency: number
}

interface UseSessionStateReturn {
  sessionState: SessionState | null
  lastAction: { action: string; username: string } | null
  syncStatus: { delta: number; timestamp: number } | null
  pendingState: SessionState | null
  mySocketId: string | null
  isHandlingRemoteEventRef: React.MutableRefObject<boolean>
  expectedPlayerStateRef: React.MutableRefObject<'playing' | 'paused' | null>
}

export const useSessionState = ({
  socket,
  hasJoined,
  playerRef,
  latency,
}: UseSessionStateProps): UseSessionStateReturn => {
  const [sessionState, setSessionState] = useState<SessionState | null>(null)
  const [lastAction, setLastAction] = useState<{ action: string; username: string } | null>(null)
  const [syncStatus, setSyncStatus] = useState<{ delta: number; timestamp: number } | null>(null)
  
  const lastSeqRef = useRef<number>(0)
  const isHandlingRemoteEventRef = useRef<boolean>(false)
  const pendingStateRef = useRef<SessionState | null>(null)
  const lastKnownTimeRef = useRef<number>(0)
  const isNewJoinerRef = useRef<boolean>(false)
  const expectedPlayerStateRef = useRef<'playing' | 'paused' | null>(null)
  const mySocketIdRef = useRef<string | null>(null)
  const initializationCompleteRef = useRef<boolean>(false)
  const hasJoinedRef = useRef(false)
  const lastActionTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    hasJoinedRef.current = hasJoined
  }, [hasJoined])

  useEffect(() => {
    if (!socket) return

    mySocketIdRef.current = socket.id || null

    // Handle initial session state
    const handleSessionInit = (state: SessionState) => {
      if (initializationCompleteRef.current && hasJoinedRef.current) {
        return
      }
      
      if (typeof state.seq === 'number') {
        lastSeqRef.current = state.seq
      }
      setSessionState(state)
      pendingStateRef.current = state
      
      if (!initializationCompleteRef.current) {
        initializationCompleteRef.current = true
      }
      
      const player = playerRef.current
      if (state.videoId && player && hasJoinedRef.current) {
        isHandlingRemoteEventRef.current = true
        
        const compensatedTime = state.playbackTime + (latency / 2000)
        
        player.seekTo(compensatedTime, true)
        lastKnownTimeRef.current = compensatedTime
        
        if (state.isPlaying) {
          player.playVideo()
        } else {
          player.pauseVideo()
        }
        
        isNewJoinerRef.current = true
        setTimeout(() => {
          isNewJoinerRef.current = false
        }, 5000)
        
        setTimeout(() => {
          isHandlingRemoteEventRef.current = false
        }, 100)
      }
    }
    
    socket.on(SocketEvents.INIT, handleSessionInit)

    socket.on(SocketEvents.PLAY_BROADCAST, (data: PlayBroadcastPayload) => {
      if (data.seq <= lastSeqRef.current) return
      lastSeqRef.current = data.seq
      
      const isFromMe = socket?.id === mySocketIdRef.current
      // Show action for all users
      setLastAction({ action: 'played', username: data.username })
      // Clear last action after 3 seconds
      if (lastActionTimeoutRef.current) {
        clearTimeout(lastActionTimeoutRef.current)
      }
      lastActionTimeoutRef.current = setTimeout(() => {
        setLastAction(null)
      }, 3000)
      
      const player = playerRef.current
      if (player && hasJoinedRef.current) {
        isHandlingRemoteEventRef.current = true
        expectedPlayerStateRef.current = 'playing'
        
        const localTime = player.getCurrentTime()
        const delta = data.time - localTime
        
        if (!isFromMe && Math.abs(delta) > 0.3) {
          player.seekTo(data.time, true)
          lastKnownTimeRef.current = data.time
        } else if (isFromMe && Math.abs(delta) > 1.0) {
          player.seekTo(data.time, true)
          lastKnownTimeRef.current = data.time
        }
        player.playVideo()
        
        setTimeout(() => {
          isHandlingRemoteEventRef.current = false
        }, 300)
        
        setTimeout(() => {
          expectedPlayerStateRef.current = null
        }, 500)
      }
      setSessionState(prev => (prev ? { ...prev, isPlaying: true, playbackTime: data.time } : null))
    })

    socket.on(SocketEvents.PAUSE_BROADCAST, (data: PauseBroadcastPayload) => {
      if (data.seq <= lastSeqRef.current) return
      lastSeqRef.current = data.seq
      
      const isFromMe = socket?.id === mySocketIdRef.current
      // Show action for all users
      setLastAction({ action: 'paused', username: data.username })
      // Clear last action after 3 seconds
      if (lastActionTimeoutRef.current) {
        clearTimeout(lastActionTimeoutRef.current)
      }
      lastActionTimeoutRef.current = setTimeout(() => {
        setLastAction(null)
      }, 3000)
      
      const player = playerRef.current
      if (player && hasJoinedRef.current) {
        isHandlingRemoteEventRef.current = true
        expectedPlayerStateRef.current = 'paused'
        
        const localTime = player.getCurrentTime()
        const delta = data.time - localTime
        
        if (!isFromMe && Math.abs(delta) > 0.3) {
          player.seekTo(data.time, true)
          lastKnownTimeRef.current = data.time
        } else if (isFromMe && Math.abs(delta) > 1.0) {
          player.seekTo(data.time, true)
          lastKnownTimeRef.current = data.time
        }
        player.pauseVideo()
        
        setTimeout(() => {
          isHandlingRemoteEventRef.current = false
        }, 300)
        
        setTimeout(() => {
          expectedPlayerStateRef.current = null
        }, 500)
      }
      setSessionState(prev => (prev ? { ...prev, isPlaying: false, playbackTime: data.time } : null))
    })

    socket.on(SocketEvents.SEEK_BROADCAST, (data: SeekBroadcastPayload) => {
      if (data.seq <= lastSeqRef.current) return
      lastSeqRef.current = data.seq
      
      const isFromMe = socket?.id === mySocketIdRef.current
      if (!isFromMe) {
        setLastAction({ action: 'seeked', username: data.username })
        // Clear last action after 3 seconds
        if (lastActionTimeoutRef.current) {
          clearTimeout(lastActionTimeoutRef.current)
        }
        lastActionTimeoutRef.current = setTimeout(() => {
          setLastAction(null)
        }, 3000)
      }
      
      const player = playerRef.current
      if (player && hasJoinedRef.current) {
        isHandlingRemoteEventRef.current = true
        player.seekTo(data.time, true)
        lastKnownTimeRef.current = data.time
        
        setTimeout(() => {
          isHandlingRemoteEventRef.current = false
        }, 100)
      }
      setSessionState(prev => (prev ? { ...prev, playbackTime: data.time } : null))
    })

    socket.on(SocketEvents.VIDEO_CHANGE, (data: VideoChangeBroadcastPayload) => {
      // Skip if this is an old event (arrived out of order)
      if (data.seq <= lastSeqRef.current) return
      
      // If we're very far behind (>10 events), we're a stale tab
      // Accept the event and reset our sequence
      const seqDiff = data.seq - lastSeqRef.current
      if (seqDiff > 10) {
        // Stale tab - reset sequence and accept
        lastSeqRef.current = data.seq
      } else {
        // Normal event, just update sequence
        lastSeqRef.current = data.seq
      }
      setLastAction({ action: 'changed video', username: data.username })
      // Clear last action after 3 seconds
      if (lastActionTimeoutRef.current) {
        clearTimeout(lastActionTimeoutRef.current)
      }
      lastActionTimeoutRef.current = setTimeout(() => {
        setLastAction(null)
      }, 3000)
      setSessionState(prev => {
        const newState = prev ? { ...prev, videoId: data.videoId, playbackTime: 0, isPlaying: false } : null
        pendingStateRef.current = newState
        return newState
      })
    })

    socket.on(SocketEvents.USER_JOINED, (data: UserJoinedPayload) => {
      setSessionState(prev => {
        if (!prev) return prev
        return {
          ...prev,
          users: {
            ...prev.users,
            [data.user.socketId]: data.user
          }
        }
      })
    })

    socket.on(SocketEvents.USER_LEFT, (data: UserLeftPayload) => {
      setSessionState(prev => {
        if (!prev) return prev
        const newUsers = { ...prev.users }
        delete newUsers[data.socketId]
        return {
          ...prev,
          users: newUsers
        }
      })
    })

    // Periodic sync correction
    socket.on(SocketEvents.SYNC, (data: SyncPayload) => {
      const player = playerRef.current
      if (!player || !hasJoinedRef.current) return
      
      if (isHandlingRemoteEventRef.current && expectedPlayerStateRef.current !== null) return
      
      const localTime = player.getCurrentTime()
      const compensatedServerTime = data.time + (latency / 2000)
      const delta = compensatedServerTime - localTime
      
      setSyncStatus({ delta, timestamp: Date.now() })
      
      const absDelta = Math.abs(delta)
      
      if (isNewJoinerRef.current && absDelta > 0.3) {
        player.seekTo(compensatedServerTime, true)
        lastKnownTimeRef.current = compensatedServerTime
      } else if (absDelta > 0.8) {
        player.seekTo(compensatedServerTime, true)
        lastKnownTimeRef.current = compensatedServerTime
      }
    })

    return () => {
      socket.off(SocketEvents.INIT, handleSessionInit)
      socket.off(SocketEvents.PLAY_BROADCAST)
      socket.off(SocketEvents.PAUSE_BROADCAST)
      socket.off(SocketEvents.SEEK_BROADCAST)
      socket.off(SocketEvents.VIDEO_CHANGE)
      socket.off(SocketEvents.USER_JOINED)
      socket.off(SocketEvents.USER_LEFT)
      socket.off(SocketEvents.SYNC)
      // Clear timeout on cleanup
      if (lastActionTimeoutRef.current) {
        clearTimeout(lastActionTimeoutRef.current)
      }
    }
  }, [socket, latency, playerRef])

  return {
    sessionState,
    lastAction,
    syncStatus,
    pendingState: pendingStateRef.current,
    mySocketId: mySocketIdRef.current,
    isHandlingRemoteEventRef,
    expectedPlayerStateRef,
  }
}
