import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import YouTube from 'react-youtube'
import {
  extractVideoId,
  SocketEvents,
  SessionState,
  SessionPlayBroadcast,
  SessionPauseBroadcast,
  SessionSeekBroadcast,
  SessionVideoChangeBroadcast,
  SessionUpdateBroadcast,
  SessionPlayPayload,
  SessionPausePayload,
  SessionSeekPayload,
  SessionChangeVideoPayload,
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

    newSocket.on(SocketEvents.INIT, (state: SessionState) => {
      // Initialize last seen sequence
      if (typeof state.seq === 'number') {
        lastSeqRef.current = state.seq
      }
      setSessionState(state)
      const player = playerRef.current
      if (state.videoId && player) {
        if (state.isPlaying) {
          player.playVideo()
        } else {
          player.pauseVideo()
        }
        player.seekTo(state.playbackTime, true)
      }
    })

    newSocket.on(SocketEvents.UPDATE, (state: SessionUpdateBroadcast) => {
      // Ignore stale updates
      if (typeof state.seq === 'number' && state.seq <= lastSeqRef.current) return
      if (typeof state.seq === 'number') {
        lastSeqRef.current = state.seq
      }

      setSessionState(state)

      const player = playerRef.current
      if (state.videoId && player) {
        const localTime = player.getCurrentTime()
        const delta = state.playbackTime - localTime
        // Only correct if significantly off to avoid jitter
        if (Math.abs(delta) > 0.4) {
          player.seekTo(state.playbackTime, true)
        }
        if (state.isPlaying) {
          player.playVideo()
        } else {
          player.pauseVideo()
        }
      }
    })

    newSocket.on(SocketEvents.PLAY_BROADCAST, (data: SessionPlayBroadcast) => {
      if (data.seq <= lastSeqRef.current) return
      lastSeqRef.current = data.seq
      const player = playerRef.current
      if (player) {
        const localTime = player.getCurrentTime()
        const delta = data.time - localTime
        // Only snap if we're meaningfully off
        if (Math.abs(delta) > 0.3) {
          player.seekTo(data.time, true)
        }
        player.playVideo()
      }
      setSessionState(prev => (prev ? { ...prev, isPlaying: true } : null))
    })

    newSocket.on(SocketEvents.PAUSE_BROADCAST, (data: SessionPauseBroadcast) => {
      if (data.seq <= lastSeqRef.current) return
      lastSeqRef.current = data.seq
      const player = playerRef.current
      if (player) {
        const localTime = player.getCurrentTime()
        const delta = data.time - localTime
        if (Math.abs(delta) > 0.3) {
          player.seekTo(data.time, true)
        }
        player.pauseVideo()
      }
      setSessionState(prev => (prev ? { ...prev, isPlaying: false } : null))
    })

    newSocket.on(SocketEvents.SEEK_BROADCAST, (data: SessionSeekBroadcast) => {
      if (data.seq <= lastSeqRef.current) return
      lastSeqRef.current = data.seq
      const player = playerRef.current
      if (player) {
        const localTime = player.getCurrentTime()
        const delta = data.time - localTime
        if (Math.abs(delta) > 0.2) {
          player.seekTo(data.time, true)
        }
      }
      setSessionState(prev => (prev ? { ...prev, playbackTime: data.time } : null))
    })

    newSocket.on(SocketEvents.VIDEO_CHANGE, (data: SessionVideoChangeBroadcast) => {
      if (data.seq <= lastSeqRef.current) return
      lastSeqRef.current = data.seq
      setSessionState(prev => (prev ? { ...prev, videoId: data.videoId, playbackTime: 0 } : null))
    })

    return () => {
      newSocket.close()
    }
  }, [])

  const handleVideoChange = () => {
    const videoId = extractVideoId(videoUrl)
    if (videoId && socket) {
      setIsSettingVideo(true)
      const payload: SessionChangeVideoPayload = { videoId }
      socket.emit(SocketEvents.CHANGE_VIDEO, payload)
      setVideoUrl('')
      // Clear loading state shortly after to keep UI snappy
      setTimeout(() => setIsSettingVideo(false), 400)
    }
  }

  const handlePlay = () => {
    const player = playerRef.current
    if (socket && player) {
      const currentTime = player.getCurrentTime()
      const payload: SessionPlayPayload = { time: currentTime }
      socket.emit(SocketEvents.PLAY, payload)
    }
  }

  const handlePause = () => {
    const player = playerRef.current
    if (socket && player) {
      const currentTime = player.getCurrentTime()
      const payload: SessionPausePayload = { time: currentTime }
      socket.emit(SocketEvents.PAUSE, payload)
    }
  }

  const handleSeek = (event: YT.PlayerEvent) => {
    if (socket) {
      const payload: SessionSeekPayload = { time: event.data }
      socket.emit(SocketEvents.SEEK, payload)
    }
  }

  const onReady = (event: { target: YT.Player }) => {
    playerRef.current = event.target
    if (sessionState) {
      event.target.seekTo(sessionState.playbackTime, true)
      if (sessionState.isPlaying) {
        event.target.playVideo()
      }
    }
  }

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
                  },
                }}
                onReady={onReady}
                onStateChange={(event: YT.PlayerEvent) => {
                  // 1 = PLAYING, 2 = PAUSED (YouTube IFrame API)
                  if (event.data === 1) {
                    handlePlay()
                  } else if (event.data === 2) {
                    handlePause()
                  }
                }}
                onSeek={handleSeek}
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

