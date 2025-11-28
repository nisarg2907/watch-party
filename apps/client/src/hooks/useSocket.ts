import { useEffect, useState, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import { SocketEvents } from '@watchparty/shared'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://192.168.1.12:4000'

interface UseSocketReturn {
  socket: Socket | null
  connectionStatus: 'connecting' | 'connected' | 'error'
  connectionError: string | null
  latency: number
}

export const useSocket = (username: string, hasJoined: boolean): UseSocketReturn => {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error'>('connecting')
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const latencyRef = useRef<number>(0)
  const hasJoinedRef = useRef(false)

  useEffect(() => {
    hasJoinedRef.current = hasJoined
  }, [hasJoined])

  useEffect(() => {
    const newSocket = io(SOCKET_URL)
    setSocket(newSocket)

    newSocket.on('connect', () => {
      setConnectionStatus('connected')
      setConnectionError(null)
      
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
      if (hasJoinedRef.current && username) {
        newSocket.emit(SocketEvents.JOIN, { username })
      }
    })

    newSocket.on('connect_error', (err) => {
      setConnectionStatus('error')
      setConnectionError(err.message ?? 'Unable to connect')
    })

    return () => {
      newSocket.close()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    socket,
    connectionStatus,
    connectionError,
    latency: latencyRef.current,
  }
}
