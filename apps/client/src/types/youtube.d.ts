// YouTube IFrame API Player types
declare namespace YT {
  interface Player {
    playVideo(): void
    pauseVideo(): void
    seekTo(seconds: number, allowSeekAhead: boolean): void
    getCurrentTime(): number
    getPlayerState(): number
  }

  interface PlayerState {
    UNSTARTED: -1
    ENDED: 0
    PLAYING: 1
    PAUSED: 2
    BUFFERING: 3
    CUED: 5
  }

  interface PlayerEvent {
    target: Player
    data: number
  }
}

