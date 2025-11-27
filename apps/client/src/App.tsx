import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import YouTube from 'react-youtube'
import { 
  extractVideoId, 
  SessionState,
  PlayBroadcastPayload,
  PauseBroadcastPayload,
  SeekBroadcastPayload,
  VideoChangeBroadcastPayload
} from '@watchparty/shared'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://192.168.1.12:4000'

function App() {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [sessionState, setSessionState] = useState<SessionState | null>(null)
  const [videoUrl, setVideoUrl] = useState('')
  const [isSettingVideo, setIsSettingVideo] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error'>('connecting')
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const playerRef = useRef<YT.Player | null>(null)
  const lastSeqRef = useRef<number>(0)
  const isHandlingRemoteEventRef = useRef<boolean>(false)
  const pendingStateRef = useRef<SessionState | null>(null)
  const lastKnownTimeRef = useRef<number>(0)
  const seekCheckIntervalRef = useRef<NodeJS.Timeout | null>(null)

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
      // Initialize last seen sequence
      if (typeof state.seq === 'number') {
        lastSeqRef.current = state.seq
      }
      setSessionState(state)
      pendingStateRef.current = state
      
      // Apply state to player if it's ready
      const player = playerRef.current
      if (state.videoId && player) {
        isHandlingRemoteEventRef.current = true
        player.seekTo(state.playbackTime, true)
        
        // Use a timeout to ensure seek completes before play/pause
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
      
      const player = playerRef.current
      if (player) {
        isHandlingRemoteEventRef.current = true
        const localTime = player.getCurrentTime()
        const delta = data.time - localTime
        // Only snap if we're meaningfully off
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
      
      const player = playerRef.current
      if (player) {
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
      
      const player = playerRef.current
      if (player) {
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
      setSessionState(prev => {
        const newState = prev ? { ...prev, videoId: data.videoId, playbackTime: 0, isPlaying: false } : null
        pendingStateRef.current = newState
        return newState
      })
    })

    return () => {
      newSocket.close()
    }
  }, [])

  const handleVideoChange = () => {
    const videoId = extractVideoId(videoUrl)
    if (videoId && socket) {
      setIsSettingVideo(true)
      socket.emit('session:changeVideo', { videoId })
      setVideoUrl('')
      // Clear loading state shortly after to keep UI snappy
      setTimeout(() => setIsSettingVideo(false), 400)
    }
  }

  const handlePlay = useCallback(() => {
    // Don't emit if we're handling a remote event
    if (isHandlingRemoteEventRef.current) return
    
    const player = playerRef.current
    if (socket && player) {
      const currentTime = player.getCurrentTime()
      console.log('[CLIENT] emitting play', currentTime)
      socket.emit('session:play', { time: currentTime })
    }
  }, [socket])

  const handlePause = useCallback(() => {
    // Don't emit if we're handling a remote event
    if (isHandlingRemoteEventRef.current) return
    
    const player = playerRef.current
    if (socket && player) {
      const currentTime = player.getCurrentTime()
      console.log('[CLIENT] emitting pause', currentTime)
      socket.emit('session:pause', { time: currentTime })
    }
  }, [socket])

  // Check for seeks by monitoring time changes
  useEffect(() => {
    if (!playerRef.current || !socket) return

    const checkInterval = setInterval(() => {
      const player = playerRef.current
      if (!player || isHandlingRemoteEventRef.current) return

      const currentTime = player.getCurrentTime()
      const timeDiff = Math.abs(currentTime - lastKnownTimeRef.current)
      
      // If time jumped more than 1.5 seconds (not normal playback), it's a seek
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
  }, [socket])

  const onReady = useCallback((event: { target: YT.Player }) => {
    console.log('[CLIENT] player ready')
    playerRef.current = event.target
    
    // Apply pending state when player becomes ready
    const state = pendingStateRef.current
    if (state && state.videoId) {
      isHandlingRemoteEventRef.current = true
      console.log('[CLIENT] applying pending state', state)
      
      event.target.seekTo(state.playbackTime, true)
      lastKnownTimeRef.current = state.playbackTime
      
      // Use a longer timeout to ensure seek completes before play/pause
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
  }, [])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:py-10">
        <header className="flex flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Watch Party
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Paste a YouTube link and stay in sync across tabs and devices.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Socket URL:{' '}
              <span className="font-mono text-[11px] text-slate-300">
                {SOCKET_URL}
              </span>
            </p>
          </div>
          <div className="mt-2 flex flex-col items-start gap-1 text-xs sm:mt-0 sm:items-end">
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex h-2 w-2 rounded-full ${
                  connectionStatus === 'connected'
                    ? 'bg-emerald-400'
                    : connectionStatus === 'connecting'
                      ? 'bg-amber-400'
                      : 'bg-red-400'
                }`}
              />
              <span className="font-medium uppercase tracking-wide text-slate-200">
                {connectionStatus === 'connected'
                  ? 'Connected'
                  : connectionStatus === 'connecting'
                    ? 'Connecting...'
                    : 'Connection error'}
              </span>
            </div>
            {connectionError && (
              <p className="max-w-xs text-[11px] text-red-300 text-right">
                {connectionError}
              </p>
            )}
          </div>
        </header>

        <section className="flex flex-col gap-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
                YouTube URL
              </label>
              <input
                type="text"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 shadow-sm outline-none ring-0 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/40"
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={handleVideoChange}
                disabled={!videoUrl || !socket || connectionStatus !== 'connected' || isSettingVideo}
                className="inline-flex w-full items-center justify-center rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-emerald-950 shadow-sm transition hover:bg-emerald-400 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:bg-slate-700 sm:w-auto"
              >
                {isSettingVideo ? 'Setting...' : 'Set video'}
              </button>
            </div>
          </div>

          {sessionState && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-300">
              <span className="font-medium text-slate-200">Session</span>
              <span className="h-1 w-1 rounded-full bg-slate-600" />
              <span>
                Last action:{' '}
                <span className="font-medium text-emerald-300">
                  {sessionState.lastAction || 'init'}
                </span>
              </span>
              <span className="h-1 w-1 rounded-full bg-slate-600" />
              <span>
                By:{' '}
                <span className="font-mono text-xs text-slate-200">
                  {sessionState.lastActionBy || 'system'}
                </span>
              </span>
              <span className="h-1 w-1 rounded-full bg-slate-600" />
              <span>
                Seq:{' '}
                <span className="font-mono text-xs text-slate-400">
                  {sessionState.seq}
                </span>
              </span>
            </div>
          )}
        </section>

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
                  // Don't handle state changes if we're applying remote events
                  if (isHandlingRemoteEventRef.current) {
                    console.log('[CLIENT] ignoring state change during remote event', event.data)
                    return
                  }
                  
                  // 1 = PLAYING, 2 = PAUSED (YouTube IFrame API)
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
            <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 text-center text-slate-400">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-slate-700 bg-slate-900/60">
                <span className="text-lg">▶️</span>
              </div>
              <p className="text-sm">
                Paste a YouTube link above and click{' '}
                <span className="font-medium text-emerald-300">Set video</span>{' '}
                to start your watch party.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

export default App

