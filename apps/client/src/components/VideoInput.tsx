import { useState, useCallback } from 'react'
import { Socket } from 'socket.io-client'
import { extractVideoId, SocketEvents } from '@watchparty/shared'

interface VideoInputProps {
  socket: Socket | null
  connectionStatus: 'connecting' | 'connected' | 'error'
}

export const VideoInput = ({ socket, connectionStatus }: VideoInputProps) => {
  const [videoUrl, setVideoUrl] = useState('')
  const [isSettingVideo, setIsSettingVideo] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleVideoChange = useCallback(() => {
    setError(null)
    
    const videoId = extractVideoId(videoUrl)
    if (!videoId) {
      setError('Please enter a valid YouTube URL')
      return
    }
    
    if (socket) {
      setIsSettingVideo(true)
      socket.emit(SocketEvents.CHANGE_VIDEO, { videoId })
      setVideoUrl('')
      setTimeout(() => setIsSettingVideo(false), 400)
    }
  }, [videoUrl, socket])

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
        <input
          type="text"
          value={videoUrl}
          onChange={(e) => {
            setVideoUrl(e.target.value)
            if (error) setError(null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && handleVideoChange()}
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
      </div>
      {error && (
        <div className="text-xs text-red-400 px-1">
          {error}
        </div>
      )}
    </section>
  )
}
