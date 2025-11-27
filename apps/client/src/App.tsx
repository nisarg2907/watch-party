import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import YouTube from 'react-youtube'
import { 
  extractVideoId, 
  SessionState,
  PlayBroadcastPayload,
  PauseBroadcastPayload,
  SeekBroadcastPayload,
  VideoChangeBroadcastPayload,
  UserJoinedPayload,
  UserLeftPayload,
  SyncPayload
} from '@watchparty/shared'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://192.168.1.12:4000'

function App() {
  // Connection & User State
  const [socket, setSocket] = useState<Socket | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error'>('connecting')
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [hasJoined, setHasJoined] = useState(false)
  const hasJoinedRef = useRef(false)
  const [inputUsername, setInputUsername] = useState('')
  
  // Session State
  const [sessionState, setSessionState] = useState<SessionState | null>(null)
  const [videoUrl, setVideoUrl] = useState('')
  const [isSettingVideo, setIsSettingVideo] = useState(false)
  const [lastAction, setLastAction] = useState<{ action: string; username: string } | null>(null)
  const [syncStatus, setSyncStatus] = useState<{ delta: number; timestamp: number } | null>(null)
  
  // Player Refs
  const playerRef = useRef<YT.Player | null>(null)
  const lastSeqRef = useRef<number>(0)
  const isHandlingRemoteEventRef = useRef<boolean>(false)
  const pendingStateRef = useRef<SessionState | null>(null)
  const lastKnownTimeRef = useRef<number>(0)
  const seekCheckIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const latencyRef = useRef<number>(0) // Track network latency
  const isNewJoinerRef = useRef<boolean>(false) // Track if this is a fresh join
  const expectedPlayerStateRef = useRef<'playing' | 'paused' | null>(null) // Track expected state
  const mySocketIdRef = useRef<string | null>(null) // Track own socket ID
  const initializationCompleteRef = useRef<boolean>(false) // Track if initial session:init was processed
  const lastSeekEmitRef = useRef<number>(0) // Track last seek emission for throttling

  // Socket setup
  useEffect(() => {
    const newSocket = io(SOCKET_URL)
    setSocket(newSocket)

    newSocket.on('connect', () => {
      setConnectionStatus('connected')
      setConnectionError(null)
      mySocketIdRef.current = newSocket.id || null
      
      // Measure latency with ping/pong
      const pingStart = Date.now()
      newSocket.emit('ping')
      const pongHandler = () => {
        const rtt = Date.now() - pingStart
        latencyRef.current = rtt
        newSocket.off('pong', pongHandler)
      }
      newSocket.once('pong', pongHandler)
    })
    
    // Auto-rejoin on reconnection
    newSocket.on('reconnect', () => {
      console.log('[SOCKET] Reconnected - attempting to rejoin')
      if (hasJoinedRef.current && username) {
        // Reset initialization to allow fresh session:init
        initializationCompleteRef.current = false
        newSocket.emit('session:join', { username })
        console.log('[SOCKET] Auto-rejoined as', username)
      }
    })

    newSocket.on('connect_error', (err) => {
      setConnectionStatus('error')
      setConnectionError(err.message ?? 'Unable to connect')
    })

    // Handle initial session state - use handler to allow re-initialization on rejoin
    const handleSessionInit = (state: SessionState) => {
      // Only process session:init when joining or if not yet initialized
      if (initializationCompleteRef.current && hasJoinedRef.current) {
        // Already initialized and user has joined - ignore subsequent init events
        // unless it's a rejoin scenario (handled separately)
        return
      }
      
      if (typeof state.seq === 'number') {
        lastSeqRef.current = state.seq
      }
      setSessionState(state)
      pendingStateRef.current = state
      
      // Mark initialization as complete on first call
      if (!initializationCompleteRef.current) {
        initializationCompleteRef.current = true
      }
      
      const player = playerRef.current
      if (state.videoId && player && hasJoinedRef.current) {
        isHandlingRemoteEventRef.current = true
        
        // Account for network latency - add half RTT to compensate for time in transit
        const compensatedTime = state.playbackTime + (latencyRef.current / 2000)
        
        player.seekTo(compensatedTime, true)
        lastKnownTimeRef.current = compensatedTime
        
        // Immediately set play state with no delay
        if (state.isPlaying) {
          player.playVideo()
        } else {
          player.pauseVideo()
        }
        
        // Mark as new joiner for aggressive sync
        isNewJoinerRef.current = true
        setTimeout(() => {
          isNewJoinerRef.current = false
        }, 5000) // Aggressive sync for first 5 seconds
        
        setTimeout(() => {
          isHandlingRemoteEventRef.current = false
        }, 100)
      }
    }
    
    newSocket.on('session:init', handleSessionInit)

    newSocket.on('session:play', (data: PlayBroadcastPayload) => {
      if (data.seq <= lastSeqRef.current) return
      lastSeqRef.current = data.seq
      
      // Only show action if it's from another user
      const isFromMe = socket?.id === mySocketIdRef.current
      if (!isFromMe) {
        setLastAction({ action: 'played', username: data.username })
      }
      
      const player = playerRef.current
      if (player && hasJoinedRef.current) {
        isHandlingRemoteEventRef.current = true
        expectedPlayerStateRef.current = 'playing'
        
        const localTime = player.getCurrentTime()
        const delta = data.time - localTime
        
        // Reduce snap: only seek if drift is significant OR if from another user
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

    newSocket.on('session:pause', (data: PauseBroadcastPayload) => {
      if (data.seq <= lastSeqRef.current) return
      lastSeqRef.current = data.seq
      
      // Only show action if it's from another user
      const isFromMe = socket?.id === mySocketIdRef.current
      if (!isFromMe) {
        setLastAction({ action: 'paused', username: data.username })
      }
      
      const player = playerRef.current
      if (player && hasJoinedRef.current) {
        isHandlingRemoteEventRef.current = true
        expectedPlayerStateRef.current = 'paused'
        
        const localTime = player.getCurrentTime()
        const delta = data.time - localTime
        
        // Reduce snap: only seek if drift is significant OR if from another user
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

    newSocket.on('session:seek', (data: SeekBroadcastPayload) => {
      if (data.seq <= lastSeqRef.current) return
      lastSeqRef.current = data.seq
      
      // Only show action if it's from another user
      const isFromMe = socket?.id === mySocketIdRef.current
      if (!isFromMe) {
        setLastAction({ action: 'seeked', username: data.username })
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

    newSocket.on('session:videoChange', (data: VideoChangeBroadcastPayload) => {
      if (data.seq <= lastSeqRef.current) return
      lastSeqRef.current = data.seq
      setLastAction({ action: 'changed video', username: data.username })
      setSessionState(prev => {
        const newState = prev ? { ...prev, videoId: data.videoId, playbackTime: 0, isPlaying: false } : null
        pendingStateRef.current = newState
        return newState
      })
    })

    newSocket.on('session:userJoined', (data: UserJoinedPayload) => {
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

    newSocket.on('session:userLeft', (data: UserLeftPayload) => {
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

    // Periodic sync correction - smooth playback rate adjustment
    newSocket.on('session:sync', (data: SyncPayload) => {
      const player = playerRef.current
      if (!player || !hasJoinedRef.current) return
      
      // Don't interrupt user-initiated actions, but allow sync during remote event handling
      if (isHandlingRemoteEventRef.current && expectedPlayerStateRef.current !== null) return
      
      const localTime = player.getCurrentTime()
      // Compensate for network latency
      const compensatedServerTime = data.time + (latencyRef.current / 2000)
      const delta = compensatedServerTime - localTime
      
      // Update sync status for debugging
      setSyncStatus({ delta, timestamp: Date.now() })
      
      const absDelta = Math.abs(delta)
      
      // Strategy: Only correct significant drift to avoid jitter
      // Acceptable sync tolerance: 0.5s
      if (isNewJoinerRef.current && absDelta > 0.3) {
        player.seekTo(compensatedServerTime, true)
        lastKnownTimeRef.current = compensatedServerTime
      } else if (absDelta > 0.8) {
        player.seekTo(compensatedServerTime, true)
        lastKnownTimeRef.current = compensatedServerTime
      }
      // Accept drift < 0.8s to keep playback smooth
    })

    return () => {
      newSocket.close()
    }
  }, [])

  // Join handler
  const handleJoin = useCallback(() => {
    if (!socket || !inputUsername.trim()) return
    
    const trimmedUsername = inputUsername.trim()
    setUsername(trimmedUsername)
    setHasJoined(true)
    hasJoinedRef.current = true
    
    // Mark as handling remote event to prevent seek detection during initial sync
    isHandlingRemoteEventRef.current = true
    
    socket.emit('session:join', { username: trimmedUsername })
    
    // Immediately add self to local state
    if (socket?.id) {
      setSessionState(prev => {
        if (!prev) return prev
        return {
          ...prev,
          users: {
            ...prev.users,
            [socket.id as string]: {
              socketId: socket.id as string,
              username: trimmedUsername,
              joinedAt: Date.now()
            }
          }
        }
      })
    }
    
    // Mark as new joiner for aggressive sync and clear remote event flag after sync
    isNewJoinerRef.current = true
    setTimeout(() => {
      isHandlingRemoteEventRef.current = false
    }, 1000) // Give 1 second for initial sync to complete
  }, [socket, inputUsername])

  const handleVideoChange = useCallback(() => {
    const videoId = extractVideoId(videoUrl)
    if (videoId && socket) {
      setIsSettingVideo(true)
      socket.emit('session:changeVideo', { videoId })
      setVideoUrl('')
      setTimeout(() => setIsSettingVideo(false), 400)
    }
  }, [videoUrl, socket])

  const handlePlay = useCallback(() => {
    if (isHandlingRemoteEventRef.current) return
    
    const player = playerRef.current
    if (socket && player) {
      // Emit immediately - no delay for better sync
      const currentTime = player.getCurrentTime()
      socket.emit('session:play', { time: currentTime })
    }
  }, [socket])

  const handlePause = useCallback(() => {
    if (isHandlingRemoteEventRef.current) return
    
    const player = playerRef.current
    if (socket && player) {
      const currentTime = player.getCurrentTime()
      socket.emit('session:pause', { time: currentTime })
    }
  }, [socket])

  // Seek detection
  useEffect(() => {
    if (!playerRef.current || !socket || !hasJoined) return

    const checkInterval = setInterval(() => {
      const player = playerRef.current
      if (!player || isHandlingRemoteEventRef.current) return

      const currentTime = player.getCurrentTime()
      const timeDiff = Math.abs(currentTime - lastKnownTimeRef.current)
      
      // Detect seek - only emit if it's a deliberate seek (not buffering/stuttering)
      if (timeDiff > 2.0 && lastKnownTimeRef.current > 0) {
        // Check player state to avoid false positives during buffering
        const playerState = player.getPlayerState()
        // UNSTARTED (5) or BUFFERING (3) might indicate network issues, not user seek
        if (playerState === 5 || playerState === 3) {
          // Don't emit seek during buffering or unstarted states
          lastKnownTimeRef.current = currentTime
          return
        }
        
        // Throttle seek events - max 3 per second (300ms interval)
        const now = Date.now()
        if (now - lastSeekEmitRef.current >= 300) {
          lastSeekEmitRef.current = now
          socket.emit('session:seek', { time: currentTime })
        }
      }
      
      lastKnownTimeRef.current = currentTime
    }, 500)

    seekCheckIntervalRef.current = checkInterval

    return () => {
      if (seekCheckIntervalRef.current) {
        clearInterval(seekCheckIntervalRef.current)
      }
    }
  }, [socket, hasJoined])

  const onReady = useCallback((event: { target: YT.Player }) => {
    playerRef.current = event.target
    
    const state = pendingStateRef.current
    if (state && state.videoId && hasJoinedRef.current) {
      isHandlingRemoteEventRef.current = true
      
      // Account for latency when syncing
      const compensatedTime = state.playbackTime + (latencyRef.current / 2000)
      event.target.seekTo(compensatedTime, true)
      lastKnownTimeRef.current = compensatedTime
      
      // No delay - apply state immediately
      if (state.isPlaying) {
        try {
          event.target.playVideo()
        } catch (err) {
          console.warn('Failed to play video on ready:', err)
          // Sync failed state back to server
          setSessionState(prev => prev ? { ...prev, isPlaying: false } : null)
          if (socket) {
            socket.emit('session:pause', { time: event.target.getCurrentTime() })
          }
        }
      } else {
        try {
          event.target.pauseVideo()
        } catch (err) {
          console.warn('Failed to pause video on ready:', err)
        }
      }
      
      // Mark as new joiner
      isNewJoinerRef.current = true
      setTimeout(() => {
        isNewJoinerRef.current = false
      }, 5000)
      
      setTimeout(() => {
        isHandlingRemoteEventRef.current = false
      }, 100)
    }
  }, [hasJoined])

  // Always include current user in the list, merged with session users
  const sessionUsers = sessionState ? Object.values(sessionState.users) : []
  const currentUser = sessionState && socket?.id ? sessionState.users[socket.id] : null
  
  // If current user isn't in the session users list yet, add them
  const users = currentUser || !hasJoined ? sessionUsers : [
    ...sessionUsers.filter(u => u.socketId !== socket?.id),
    { socketId: socket?.id || '', username, joinedAt: Date.now() }
  ]

  // Join Screen
  if (!hasJoined) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 border-2 border-emerald-500 mb-4">
              <span className="text-3xl">🎬</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight mb-2">
              Watch Party
            </h1>
            <p className="text-slate-400">
              Watch YouTube videos in sync with friends
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 shadow-xl backdrop-blur">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              What should we call you?
            </label>
            <input
              type="text"
              value={inputUsername}
              onChange={(e) => setInputUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              placeholder="Enter your name..."
              maxLength={20}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-50 placeholder:text-slate-500 shadow-sm outline-none ring-0 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/40 mb-4"
              autoFocus
            />
            <button
              onClick={handleJoin}
              disabled={!inputUsername.trim() || connectionStatus !== 'connected'}
              className="w-full inline-flex items-center justify-center rounded-lg bg-emerald-500 px-6 py-3 text-sm font-semibold text-emerald-950 shadow-lg transition hover:bg-emerald-400 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-slate-700 disabled:text-slate-400"
            >
              {connectionStatus === 'connected' ? 'Join Watch Party' : 'Connecting...'}
            </button>
            
            {connectionError && (
              <p className="mt-3 text-xs text-red-400 text-center">{connectionError}</p>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Main Watch Party UI
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <main className="mx-auto flex flex-col lg:flex-row min-h-screen w-full max-w-7xl gap-4 lg:gap-6 p-4 lg:p-6">
        {/* Main Content */}
        <div className="flex-1 flex flex-col gap-3 lg:gap-4 min-w-0">
          {/* Header */}
          <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Watch Party</h1>
              <p className="text-xs sm:text-sm text-slate-400 mt-0.5 sm:mt-1">Synced viewing experience</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-xs sm:text-sm">
                <span className={`inline-flex h-2 w-2 rounded-full ${connectionStatus === 'connected' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                <span className="text-slate-300">{username}</span>
              </div>
            </div>
          </header>

          {/* Video Input */}
          <section className="flex flex-col sm:flex-row gap-2 sm:gap-3">
            <input
              type="text"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="Paste YouTube URL..."
              className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 sm:px-4 py-2 sm:py-2.5 text-sm text-slate-50 placeholder:text-slate-500 shadow-sm outline-none ring-0 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/40"
            />
            <button
              onClick={handleVideoChange}
              disabled={!videoUrl || !socket || connectionStatus !== 'connected' || isSettingVideo}
              className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 sm:px-6 py-2 sm:py-2.5 text-sm font-medium text-emerald-950 shadow-sm transition hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 whitespace-nowrap"
            >
              {isSettingVideo ? 'Setting...' : 'Set Video'}
            </button>
          </section>

          {/* Video Player */}
          <section className="flex-1 rounded-xl border border-slate-800 bg-slate-900/40 p-2 sm:p-3 shadow-sm">
            {sessionState?.videoId ? (
              <div className="aspect-video w-full overflow-hidden rounded-lg border border-slate-800 bg-black">
                <YouTube
                  className="h-full w-full"
                  videoId={sessionState.videoId}
                  opts={{
                    width: '100%',
                    height: '100%',
                    playerVars: {
                      autoplay: 0,
                      controls: 1,
                      modestbranding: 1,
                      rel: 0,
                      fs: 1,
                    },
                  }}
                  onReady={onReady}
                  onStateChange={(event: YT.PlayerEvent) => {
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
                  }}
                />
              </div>
            ) : (
              <div className="flex h-full min-h-[300px] sm:min-h-[400px] flex-col items-center justify-center gap-3 text-center text-slate-400 px-4">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-slate-700 bg-slate-900/60">
                  <span className="text-2xl">▶️</span>
                </div>
                <p className="text-xs sm:text-sm">Paste a YouTube link above to start watching together</p>
              </div>
            )}
          </section>

          {/* Sync Status & Last Action */}
          <div className="flex items-center justify-center gap-4 text-xs text-slate-400 py-1">
            {lastAction && (
              <div>
                <span className="font-medium text-emerald-400">{lastAction.username}</span> {lastAction.action}
              </div>
            )}
            {syncStatus && (
              <div className="flex items-center gap-1">
                <span className="text-slate-500">Sync:</span>
                <span className={Math.abs(syncStatus.delta) > 0.3 ? 'text-orange-400' : 'text-emerald-400'}>
                  {syncStatus.delta > 0 ? '+' : ''}{syncStatus.delta.toFixed(2)}s
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <aside className="w-full lg:w-80 flex flex-col gap-3 lg:gap-4">
          {/* Participants */}
          <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 sm:p-4 shadow-sm">
            <h2 className="text-xs sm:text-sm font-semibold text-slate-200 mb-2 sm:mb-3">
              Participants ({users.length})
            </h2>
            <div className="space-y-2 max-h-[200px] lg:max-h-none overflow-y-auto">
              {users.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-3 sm:py-4">Waiting for others to join...</p>
              ) : (
                users.map((user) => (
                  <div
                    key={user.socketId}
                    className="flex items-center gap-2 rounded-lg bg-slate-900/60 px-2.5 sm:px-3 py-1.5 sm:py-2"
                  >
                    <div className="h-2 w-2 rounded-full bg-emerald-400 flex-shrink-0" />
                    <span className="text-xs sm:text-sm text-slate-200 truncate">{user.username}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>
      </main>
    </div>
  )
}

export default App
