import { useState } from 'react'
import YouTube from 'react-youtube'

interface VideoPlayerProps {
  videoId: string | null
  onReady: (event: { target: YT.Player }) => void
  onStateChange: (event: YT.PlayerEvent) => void
}

export const VideoPlayer = ({ videoId, onReady, onStateChange }: VideoPlayerProps) => {
  const [videoError, setVideoError] = useState<string | null>(null)
  
  const handleError = (event: YT.PlayerEvent) => {
    // Error codes: https://developers.google.com/youtube/iframe_api_reference#onError
    // 2 - invalid video ID
    // 5 - HTML5 player error
    // 100 - video not found or private
    // 101 - video does not allow embedding
    // 150 - same as 101
    const errorCode = event.data
    
    if (errorCode === 2) {
      setVideoError('Invalid video ID. Please check the URL.')
    } else if (errorCode === 100) {
      setVideoError('Video not found or is private. Please use a public video.')
    } else if (errorCode === 101 || errorCode === 150) {
      setVideoError('This video cannot be embedded. The owner has disabled playback on other websites.')
    } else if (errorCode === 5) {
      setVideoError('Video playback error. Please try another video.')
    } else {
      setVideoError('An error occurred while loading the video.')
    }
  }
  if (!videoId) {
    return (
      <div className="flex h-full min-h-[300px] sm:min-h-[400px] flex-col items-center justify-center gap-3 text-center text-slate-400 px-4">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-slate-700 bg-slate-900/60">
          <span className="text-2xl">▶️</span>
        </div>
        <p className="text-xs sm:text-sm">Paste a YouTube link above to start watching together</p>
      </div>
    )
  }

  return (
    <div className="aspect-video w-full overflow-hidden rounded-lg border border-slate-800 bg-black relative">
      <YouTube
        className="h-full w-full"
        videoId={videoId}
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
        onReady={(event: { target: YT.Player }) => {
          setVideoError(null)
          onReady(event)
        }}
        onStateChange={onStateChange}
        onError={handleError}
      />
      {videoError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="text-center p-6 max-w-md">
            <div className="text-4xl mb-3">⚠️</div>
            <p className="text-sm text-red-400">{videoError}</p>
            <p className="text-xs text-slate-400 mt-2">Try setting a different video</p>
          </div>
        </div>
      )}
    </div>
  )
}
