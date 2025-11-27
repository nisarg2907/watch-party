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
  UserLeftPayload
} from '@watchparty/shared'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://192.168.1.12:4000'

function App() {
  // Connection & User State
  const [socket, setSocket] = useState<Socket | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error'>('connecting')
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [hasJoined, setHasJoined] = useState(false)
  const [inputUsername, setInputUsername] = useState('')
  
  // Session State
  const [sessionState, setSessionState] = useState<SessionState | null>(null)
  const [videoUrl, setVideoUrl] = useState('')
  const [isSettingVideo, setIsSettingVideo] = useState(false)
  const [lastAction, setLastAction] = useState<{ action: string; username: string } | null>(null)
  
  // Player Refs
  const playerRef = useRef<YT.Player | null>(null)
  const lastSeqRef = useRef<number>(0)
  const isHandlingRemoteEventRef = useRef<boolean>(false)
  const pendingStateRef = useRef<SessionState | null>(null)
  const lastKnownTimeRef = useRef<number>(0)
  const seekCheckIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Socket setup
  useEffect(() => {
    const newSocket = io(SOCKET_URL)
    setSocket(newSocket)

    newSocket.on('connect', () => {
      setConnectionStatus('connected')
      setConnectionError(null)
    })

    newSocket.on('connect_error', (err) => {
      setConnectionStatus('error')
      setConnectionError(err.message ?? 'Unable to connect')
    })

    newSocket.on('session:init', (state: SessionState) => {
      console.log('[CLIENT] session:init', state)
      if (typeof state.seq === 'number') {
        lastSeqRef.current = state.seq
      }
      setSessionState(state)
      pendingStateRef.current = state
      
      const player = playerRef.current
      if (state.videoId && player && hasJoined) {
        isHandlingRemoteEventRef.current = true
        player.seekTo(state.playbackTime, true)
        
        setTimeout(() => {
          if (state.isPlaying) {
            player.playVideo()
          } else {
            player.pauseVideo()
          }
          setTimeout(() => {
            isHandlingRemoteEventRef.current = false
          }, 200)
        }, 200)
      }
    })

    newSocket.on('session:play', (data: PlayBroadcastPayload) => {
      if (data.seq <= lastSeqRef.current) return
      console.log('[CLIENT] session:play', data)
      lastSeqRef.current = data.seq
      setLastAction({ action: 'played', username: data.username })
      
      const player = playerRef.current
      if (player && hasJoined) {
        isHandlingRemoteEventRef.current = true
        const localTime = player.getCurrentTime()
        const delta = data.time - localTime
        if (Math.abs(delta) > 0.3) {
          player.seekTo(data.time, true)
        }
        player.playVideo()
        setTimeout(() => {
          isHandlingRemoteEventRef.current = false
        }, 300)
      }
      setSessionState(prev => (prev ? { ...prev, isPlaying: true, playbackTime: data.time } : null))
    })

    newSocket.on('session:pause', (data: PauseBroadcastPayload) => {
      if (data.seq <= lastSeqRef.current) return
      console.log('[CLIENT] session:pause', data)
      lastSeqRef.current = data.seq
      setLastAction({ action: 'paused', username: data.username })
      
      const player = playerRef.current
      if (player && hasJoined) {
        isHandlingRemoteEventRef.current = true
        const localTime = player.getCurrentTime()
        const delta = data.time - localTime
        if (Math.abs(delta) > 0.3) {
          player.seekTo(data.time, true)
        }
        player.pauseVideo()
        setTimeout(() => {
          isHandlingRemoteEventRef.current = false
        }, 300)
      }
      setSessionState(prev => (prev ? { ...prev, isPlaying: false, playbackTime: data.time } : null))
    })

    newSocket.on('session:seek', (data: SeekBroadcastPayload) => {
      if (data.seq <= lastSeqRef.current) return
      console.log('[CLIENT] session:seek', data)
      lastSeqRef.current = data.seq
      setLastAction({ action: 'seeked', username: data.username })
      
      const player = playerRef.current
      if (player && hasJoined) {
        isHandlingRemoteEventRef.current = true
        const localTime = player.getCurrentTime()
        const delta = data.time - localTime
        if (Math.abs(delta) > 0.2) {
          player.seekTo(data.time, true)
        }
        setTimeout(() => {
          isHandlingRemoteEventRef.current = false
        }, 300)
      }
      setSessionState(prev => (prev ? { ...prev, playbackTime: data.time } : null))
    })

    newSocket.on('session:videoChange', (data: VideoChangeBroadcastPayload) => {
      if (data.seq <= lastSeqRef.current) return
      console.log('[CLIENT] session:videoChange', data)
      lastSeqRef.current = data.seq
      setLastAction({ action: 'changed video', username: data.username })
      setSessionState(prev => {
        const newState = prev ? { ...prev, videoId: data.videoId, playbackTime: 0, isPlaying: false } : null
        pendingStateRef.current = newState
        return newState
      })
    })

    newSocket.on('session:userJoined', (data: UserJoinedPayload) => {
      console.log('[CLIENT] user joined', data.user)
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
      console.log('[CLIENT] user left', data)
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

    return () => {
      newSocket.close()
    }
  }, [hasJoined])

  // Join handler
  const handleJoin = useCallback(() => {
    if (!socket || !inputUsername.trim()) return
    
    const trimmedUsername = inputUsername.trim()
    setUsername(trimmedUsername)
    setHasJoined(true)
    
    console.log('[CLIENT] Joining with username:', trimmedUsername)
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
    
    // If there's a pending state with a playing video, start it
    setTimeout(() => {
      const state = pendingStateRef.current
      if (state && state.videoId && state.isPlaying && playerRef.current) {
        isHandlingRemoteEventRef.current = true
        playerRef.current.playVideo()
        setTimeout(() => {
          isHandlingRemoteEventRef.current = false
        }, 300)
      }
    }, 500)
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
      const currentTime = player.getCurrentTime()
      console.log('[CLIENT] emitting play', currentTime)
      socket.emit('session:play', { time: currentTime })
    }
  }, [socket])

  const handlePause = useCallback(() => {
    if (isHandlingRemoteEventRef.current) return
    
    const player = playerRef.current
    if (socket && player) {
      const currentTime = player.getCurrentTime()
      console.log('[CLIENT] emitting pause', currentTime)
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
      
      if (timeDiff > 1.5 && lastKnownTimeRef.current > 0) {
        console.log('[CLIENT] detected seek', { from: lastKnownTimeRef.current, to: currentTime })
        socket.emit('session:seek', { time: currentTime })
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
    console.log('[CLIENT] player ready')
    playerRef.current = event.target
    
    const state = pendingStateRef.current
    if (state && state.videoId && hasJoined) {
      isHandlingRemoteEventRef.current = true
      console.log('[CLIENT] applying pending state', state)
      
      event.target.seekTo(state.playbackTime, true)
      lastKnownTimeRef.current = state.playbackTime
      
      setTimeout(() => {
        if (state.isPlaying) {
          console.log('[CLIENT] autoplay from pending state')
          try {
            event.target.playVideo()
            console.log('[CLIENT] autoplay requested')
          } catch (err) {
            console.error('[CLIENT] autoplay failed:', err)
          }
        } else {
          event.target.pauseVideo()
        }
        setTimeout(() => {
          isHandlingRemoteEventRef.current = false
        }, 300)
      }, 300)
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
      <main className="mx-auto flex min-h-screen w-full max-w-7xl gap-6 p-4 lg:p-6">
        {/* Main Content */}
        <div className="flex-1 flex flex-col gap-4">
          {/* Header */}
          <header className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Watch Party</h1>
              <p className="text-sm text-slate-400 mt-1">Synced viewing experience</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-sm">
                <span className={`inline-flex h-2 w-2 rounded-full ${connectionStatus === 'connected' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                <span className="text-slate-300">{username}</span>
              </div>
            </div>
          </header>

          {/* Video Input */}
          <section className="flex gap-3">
            <input
              type="text"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="Paste YouTube URL..."
              className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-slate-50 placeholder:text-slate-500 shadow-sm outline-none ring-0 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/40"
            />
            <button
              onClick={handleVideoChange}
              disabled={!videoUrl || !socket || connectionStatus !== 'connected' || isSettingVideo}
              className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-6 py-2.5 text-sm font-medium text-emerald-950 shadow-sm transition hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              {isSettingVideo ? 'Setting...' : 'Set Video'}
            </button>
          </section>

          {/* Video Player */}
          <section className="flex-1 rounded-xl border border-slate-800 bg-slate-900/40 p-3 shadow-sm">
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
                      console.log('[CLIENT] ignoring state change during remote event', event.data)
                      return
                    }
                    
                    if (event.data === 1) {
                      console.log('[CLIENT] user played video')
                      handlePlay()
                    } else if (event.data === 2) {
                      console.log('[CLIENT] user paused video')
                      handlePause()
                    }
                  }}
                />
              </div>
            ) : (
              <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-3 text-center text-slate-400">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-slate-700 bg-slate-900/60">
                  <span className="text-2xl">▶️</span>
                </div>
                <p className="text-sm">Paste a YouTube link above to start watching together</p>
              </div>
            )}
          </section>

          {/* Last Action */}
          {lastAction && (
            <div className="text-xs text-slate-400 text-center">
              <span className="font-medium text-emerald-400">{lastAction.username}</span> {lastAction.action}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <aside className="w-80 flex flex-col gap-4">
          {/* Participants */}
          <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-200 mb-3">
              Participants ({users.length})
            </h2>
            <div className="space-y-2">
              {users.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-4">Waiting for others to join...</p>
              ) : (
                users.map((user) => (
                  <div
                    key={user.socketId}
                    className="flex items-center gap-2 rounded-lg bg-slate-900/60 px-3 py-2"
                  >
                    <div className="h-2 w-2 rounded-full bg-emerald-400" />
                    <span className="text-sm text-slate-200">{user.username}</span>
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
