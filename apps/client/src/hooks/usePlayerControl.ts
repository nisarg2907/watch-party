import { useCallback, useEffect, useRef } from 'react'
import { Socket } from 'socket.io-client'
import { SocketEvents, SessionState } from '@watchparty/shared'

interface UsePlayerControlProps {
  socket: Socket | null
  hasJoined: boolean
  playerRef: React.MutableRefObject<YT.Player | null>
  pendingState: SessionState | null
  latency: number
}

interface UsePlayerControlReturn {
  handlePlay: () => void
  handlePause: () => void
  onReady: (event: { target: YT.Player }) => void
  onStateChange: (event: YT.PlayerEvent) => void
}

export const usePlayerControl = ({
  socket,
  hasJoined,
  playerRef,
  pendingState,
  latency,
}: UsePlayerControlProps): UsePlayerControlReturn => {
  const isHandlingRemoteEventRef = useRef<boolean>(false)
  const lastKnownTimeRef = useRef<number>(0)
  const isNewJoinerRef = useRef<boolean>(false)
  const expectedPlayerStateRef = useRef<'playing' | 'paused' | null>(null)
  const lastSeekEmitRef = useRef<number>(0)

  const handlePlay = useCallback(() => {
    if (isHandlingRemoteEventRef.current) return
    
    const player = playerRef.current
    if (socket && player) {
      const currentTime = player.getCurrentTime()
      socket.emit(SocketEvents.PLAY, { time: currentTime })
    }
  }, [socket, playerRef])

  const handlePause = useCallback(() => {
    if (isHandlingRemoteEventRef.current) return
    
    const player = playerRef.current
    if (socket && player) {
      const currentTime = player.getCurrentTime()
      socket.emit(SocketEvents.PAUSE, { time: currentTime })
    }
  }, [socket, playerRef])

  // Seek detection
  useEffect(() => {
    if (!playerRef.current || !socket || !hasJoined) return

    const checkInterval = setInterval(() => {
      const player = playerRef.current
      if (!player || isHandlingRemoteEventRef.current) return

      const currentTime = player.getCurrentTime()
      const timeDiff = Math.abs(currentTime - lastKnownTimeRef.current)
      
      // Detect seek - only emit if it's a deliberate seek
      if (timeDiff > 2.0 && lastKnownTimeRef.current > 0) {
        const playerState = player.getPlayerState()
        // Don't emit seek during buffering or unstarted states
        if (playerState === 5 || playerState === 3) {
          lastKnownTimeRef.current = currentTime
          return
        }
        
        // Throttle seek events - max 3 per second (300ms interval)
        const now = Date.now()
        if (now - lastSeekEmitRef.current >= 300) {
          lastSeekEmitRef.current = now
          socket.emit(SocketEvents.SEEK, { time: currentTime })
        }
      }
      
      lastKnownTimeRef.current = currentTime
    }, 500)

    return () => {
      clearInterval(checkInterval)
    }
  }, [socket, hasJoined, playerRef])

  const onReady = useCallback((event: { target: YT.Player }) => {
    playerRef.current = event.target
    
    const state = pendingState
    if (state && state.videoId && hasJoined) {
      isHandlingRemoteEventRef.current = true
      
      const compensatedTime = state.playbackTime + (latency / 2000)
      event.target.seekTo(compensatedTime, true)
      lastKnownTimeRef.current = compensatedTime
      
      if (state.isPlaying) {
        try {
          event.target.playVideo()
        } catch (err) {
          console.warn('Failed to play video on ready:', err)
        }
      } else {
        try {
          event.target.pauseVideo()
        } catch (err) {
          console.warn('Failed to pause video on ready:', err)
        }
      }
      
      isNewJoinerRef.current = true
      setTimeout(() => {
        isNewJoinerRef.current = false
      }, 5000)
      
      setTimeout(() => {
        isHandlingRemoteEventRef.current = false
      }, 100)
    }
  }, [hasJoined, pendingState, latency, playerRef])

  const onStateChange = useCallback((event: YT.PlayerEvent) => {
    if (isHandlingRemoteEventRef.current) {
      return
    }
    
    // Check if this state change matches our expected state (from remote)
    if (event.data === 1 && expectedPlayerStateRef.current === 'playing') {
      return
    }
    if (event.data === 2 && expectedPlayerStateRef.current === 'paused') {
      return
    }
    
    if (event.data === 1) {
      handlePlay()
    } else if (event.data === 2) {
      handlePause()
    }
  }, [handlePlay, handlePause])

  return {
    handlePlay,
    handlePause,
    onReady,
    onStateChange,
  }
}
