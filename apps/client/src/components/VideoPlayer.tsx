import YouTube from 'react-youtube'

interface VideoPlayerProps {
  videoId: string | null
  onReady: (event: { target: YT.Player }) => void
  onStateChange: (event: YT.PlayerEvent) => void
}

export const VideoPlayer = ({ videoId, onReady, onStateChange }: VideoPlayerProps) => {
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
    <div className="aspect-video w-full overflow-hidden rounded-lg border border-slate-800 bg-black">
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
        onReady={onReady}
        onStateChange={onStateChange}
      />
    </div>
  )
}
