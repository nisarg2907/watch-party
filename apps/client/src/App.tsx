import { useState, useCallback, useRef } from 'react'
import { SocketEvents } from '@watchparty/shared'
import { useSocket } from './hooks/useSocket'
import { useSessionState } from './hooks/useSessionState'
import { usePlayerControl } from './hooks/usePlayerControl'
import { JoinScreen } from './components/JoinScreen'
import { Header } from './components/Header'
import { VideoInput } from './components/VideoInput'
import { VideoPlayer } from './components/VideoPlayer'
import { Sidebar } from './components/Sidebar'
import { SyncStatus } from './components/SyncStatus'

function App() {
  // User State
  const [username, setUsername] = useState('')
  const [hasJoined, setHasJoined] = useState(false)
  const [inputUsername, setInputUsername] = useState('')
  
  // Player Ref
  const playerRef = useRef<YT.Player | null>(null)

  // Socket connection
  const { socket, connectionStatus, connectionError, latency } = useSocket(username, hasJoined)

  // Session state management
  const { 
    sessionState, 
    lastAction, 
    syncStatus, 
    pendingState,
    isHandlingRemoteEventRef,
    expectedPlayerStateRef,
  } = useSessionState({
    socket,
    hasJoined,
    playerRef,
    latency,
  })

  // Player controls
  const { onReady, onStateChange } = usePlayerControl({
    socket,
    hasJoined,
    playerRef,
    pendingState,
    latency,
    isHandlingRemoteEventRef,
    expectedPlayerStateRef,
  })

  // Join handler
  const handleJoin = useCallback(() => {
    if (!socket || !inputUsername.trim()) return
    
    const trimmedUsername = inputUsername.trim()
    setUsername(trimmedUsername)
    setHasJoined(true)
    
    socket.emit(SocketEvents.JOIN, { username: trimmedUsername })
  }, [socket, inputUsername])

  // Calculate users list
  const sessionUsers = sessionState ? Object.values(sessionState.users) : []
  const currentUser = sessionState && socket?.id ? sessionState.users[socket.id] : null
  
  const users = currentUser || !hasJoined ? sessionUsers : [
    ...sessionUsers.filter(u => u.socketId !== socket?.id),
    { socketId: socket?.id || '', username, joinedAt: Date.now() }
  ]

  // Join Screen
  if (!hasJoined) {
    return (
      <JoinScreen
        inputUsername={inputUsername}
        setInputUsername={setInputUsername}
        handleJoin={handleJoin}
        connectionStatus={connectionStatus}
        connectionError={connectionError}
      />
    )
  }

  // Main Watch Party UI
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <main className="mx-auto flex flex-col lg:flex-row min-h-screen w-full max-w-7xl gap-4 lg:gap-6 p-4 lg:p-6">
        {/* Main Content */}
        <div className="flex-1 flex flex-col gap-3 lg:gap-4 min-w-0">
          <Header username={username} connectionStatus={connectionStatus} />
          
          <VideoInput socket={socket} connectionStatus={connectionStatus} />
          
          {/* Video Player */}
          <section className="flex-1 rounded-xl border border-slate-800 bg-slate-900/40 p-2 sm:p-3 shadow-sm">
            <VideoPlayer
              videoId={sessionState?.videoId || null}
              onReady={onReady}
              onStateChange={onStateChange}
            />
          </section>

          <SyncStatus lastAction={lastAction} syncStatus={syncStatus} />
        </div>

        {/* Sidebar */}
        <Sidebar users={users} />
      </main>
    </div>
  )
}

export default App
